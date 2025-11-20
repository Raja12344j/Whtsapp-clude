require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

if (!PHONE_ID || !TOKEN) {
  console.warn("WARNING: WHATSAPP_PHONE_ID or WHATSAPP_ACCESS_TOKEN not set. Set them in .env");
}

// simple in-memory logs (for demo). For production use a DB.
const logs = [];

// multer for file uploads
const upload = multer({ dest: path.join(__dirname, 'uploads/') });

app.post('/api/send', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });

    const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;
    const payload = { messaging_product: "whatsapp", to, text: { body: message } };
    const response = await axios.post(url, payload, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const id = response.data?.messages?.[0]?.id || null;
    logs.push({ type: 'single', to, message, result: response.data, time: new Date().toISOString() });
    res.json({ success: true, id, raw: response.data });
  } catch (err) {
    const errData = err?.response?.data || err.message;
    logs.push({ type: 'single', to: req.body?.to, message: req.body?.message, error: errData, time: new Date().toISOString() });
    res.status(500).json({ error: errData });
  }
});

// bulk endpoint - upload a txt file with one number per line, and message in form field 'message'
app.post('/api/bulk', upload.single('numbers'), async (req, res) => {
  try {
    const message = req.body.message || '';
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');
    const numbers = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    // simple sequential sending (to avoid bursts). For production use queues and rate limits.
    const results = [];
    for (const num of numbers) {
      try {
        const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;
        const payload = { messaging_product: "whatsapp", to: num, text: { body: message } };
        const response = await axios.post(url, payload, { headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 15000 });
        results.push({ to: num, ok: true, data: response.data });
        logs.push({ type: 'bulk', to: num, message, result: response.data, time: new Date().toISOString() });
        // small delay to reduce rate pressure (200ms)
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        const eData = e?.response?.data || e.message;
        results.push({ to: num, ok: false, error: eData });
        logs.push({ type: 'bulk', to: num, message, error: eData, time: new Date().toISOString() });
      }
    }

    // cleanup upload
    fs.unlinkSync(filePath);
    res.json({ success: true, total: numbers.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

app.get('/api/logs', (req, res) => {
  res.json({ logs });
});

// simple templates storage (in memory)
const templates = [
  { id: 1, name: 'Greeting', text: 'Hello, this is a demo message from the WhatsApp Cloud API.'},
  { id: 2, name: 'Offer', text: 'Hi! Check our new offer: 20% off this week.'}
];

app.get('/api/templates', (req, res) => res.json({ templates }));
app.post('/api/templates', (req, res) => {
  const { name, text } = req.body;
  const id = templates.length ? templates[templates.length-1].id + 1 : 1;
  templates.push({ id, name, text });
  res.json({ ok: true, id });
});

// serve the panel UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`WhatsApp Cloud Panel running on http://localhost:${PORT}`);
});
