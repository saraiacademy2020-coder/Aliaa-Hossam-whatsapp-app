const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve frontend files (index.html, logo, etc.)
const frontendPath = __dirname;
app.use(express.static(frontendPath));

app.use(cors());
app.use(express.json());

// Health check — serve index.html for browser, JSON for API
app.get('/', (req, res) => {
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  } else {
    res.json({ status: 'running', connected: isConnected });
  }
});

let client = null;
let isConnected = false;
let qrGenerationStarted = false;

function initClient() {
  if (client) {
    try { client.destroy(); } catch {}
  }
  qrGenerationStarted = false;
  isConnected = false;

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    },
  });

  client.on('qr', async (qr) => {
    if (!qrGenerationStarted) {
      qrGenerationStarted = true;
      io.emit('qr', { qr: '' }); // 'generating' state
    }
    try {
      const qrImage = await qrcode.toDataURL(qr);
      io.emit('qr', { qr: qrImage });
    } catch {}
  });

  client.on('ready', () => {
    isConnected = true;
    io.emit('status', { status: 'connected' });
  });

  client.on('disconnected', (reason) => {
    isConnected = false;
    io.emit('status', { status: 'disconnected', reason });
  });

  client.on('auth_failure', () => {
    isConnected = false;
    io.emit('status', { status: 'disconnected', reason: 'auth_failure' });
  });

  client.initialize().catch(() => {});
}

// Send message endpoint
app.post('/send-message', async (req, res) => {
  const { phone, message, test } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message are required' });
  }
  if (test) {
    return res.json({ success: true, test: true, message: 'Test message received' });
  }
  if (!isConnected) {
    return res.status(400).json({ error: 'WhatsApp not connected. Scan QR first.' });
  }
  try {
    const chatId = phone.includes('@c.us') ? phone : phone.replace(/[^0-9]/g, '') + '@c.us';
    await client.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect
app.post('/api/disconnect', (req, res) => {
  try { if (client) client.destroy(); } catch {}
  isConnected = false;
  res.json({ success: true });
});

// Reset (destroy and re-init)
app.post('/api/reset', (req, res) => {
  try { if (client) client.destroy(); } catch {}
  isConnected = false;
  setTimeout(initClient, 1500);
  res.json({ success: true });
});

// Socket.io connection
io.on('connection', (socket) => {
  if (qrGenerationStarted && !isConnected) {
    socket.emit('qr', { qr: '' });
  }
  if (isConnected) {
    socket.emit('status', { status: 'connected' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('WhatsApp Backend running on port ' + PORT);
  initClient();
});
