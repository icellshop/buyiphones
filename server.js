const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const offersCatalogRouter = require('./offerscatalog');
const mailgunRouter = require('./mailgun-send').router;
const easypostWebhookRouter = require('./routes/easypost-webhook');
const generarEtiquetaRouter = require('./routes/generarEtiqueta');

// 1. Webhook: necesita body "raw", así que este debe ir ANTES del express.json general
app.use('/api/easypost-webhook', easypostWebhookRouter);

// 2. Resto de middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Otros routers
app.use(offersCatalogRouter);
app.use(mailgunRouter);
app.use(generarEtiquetaRouter);

// 4. Servir archivos estáticos de la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tmp', express.static(path.join(__dirname, 'public', 'tmp')));

// 5. Rutas de páginas (ajusta si tienes un router para esto)
app.get('/env.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = { OFFERS_ENDPOINT: "${process.env.OFFERS_ENDPOINT}" };`);
});
app.get('/sell-device', (req, res) => res.sendFile(path.join(__dirname, 'public', 'selldevice.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));
app.get('/we-are', (req, res) => res.sendFile(path.join(__dirname, 'public', 'we-are.html')));
app.get('/wholesale', (req, res) => res.sendFile(path.join(__dirname, 'public', 'wholesale.html')));
app.get('/index.html', (req, res) => res.redirect('/'));

// 6. Endpoint para registrar la oferta en la base de datos
const pool = require('./db');
app.post('/api/register-offer', async (req, res) => {
  console.log("Recibido en /api/register-offer:", req.body);
  try {
    const { offer_id, email, ip_address } = req.body;
    if (!offer_id || !email) {
      return res.status(400).json({ success: false, message: 'Faltan datos' });
    }
    const result = await pool.query(
      `INSERT INTO offers_history (offer_id, email, ip_address, created_at)
       VALUES ($1, $2, $3, now()) RETURNING id`,
      [offer_id, email, ip_address || null]
    );
    res.json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error al registrar la oferta', error: err.message });
  }
});

// 7. Catch-all para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 8. Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});