const express = require('express');
const axios = require('axios');
const path = require('path');
const EasyPost = require('@easypost/api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const api = new EasyPost(process.env.EASYPOST_API_KEY);
const sendLabelEmail = require('./mailgun-send');
const mailgunRouter = require('./mailgun-send').router;
const offersCatalogRouter = require('./offerscatalog');
const pool = require('./db');
const easypostWebhook = require('./routes/easypost-webhook');
// Importa el router corregido:
const generarEtiquetaRouter = require('./routes/generar-etiqueta');

// 1. SOLO EL WEBHOOK SIN json() ANTES (para poder usar rawBody en easypostWebhook)
app.use('/api/easypost-webhook', easypostWebhook);

// 2. Ahora sí, el resto del middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Resto de routers
app.use(offersCatalogRouter);
if (mailgunRouter) app.use(mailgunRouter);
// Usa el router corregido aquí:
app.use(generarEtiquetaRouter);

// 4. Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tmp', express.static(path.join(__dirname, 'public', 'tmp')));

// 5. Rutas de páginas
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

// 6. Endpoint para registrar la oferta
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

// 7. Endpoint para validar dirección
app.post('/validar-direccion', async (req, res) => {
  let address = req.body.address;

  if (!address) {
    const { street1, street2, city, state, zip } = req.body;
    if (!street1 || !city || !state || !zip) {
      return res.status(400).json({ error: 'Faltan campos de dirección', recibido: req.body });
    }
    address = `${street1}, ${street2 ? street2 + ', ' : ''}${city}, ${state}, ${zip}, US`;
  }

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: apiKey }
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      return res.json({
        status: 'valid',
        datos: response.data.results[0],
        addressSent: address
      });
    } else {
      return res.json({
        status: 'invalid',
        message: 'Dirección no encontrada',
        addressSent: address,
        recibido: req.body
      });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar Google', details: error.message });
  }
});

// 8. Endpoint para debug de body
app.post('/debug-body', (req, res) => {
  return res.json({ recibido: req.body });
});

// *** YA NO DEBE HABER ENDPOINT /generar-etiqueta EN ESTE ARCHIVO ***
// Lo maneja ./routes/generar-etiqueta.js a través de app.use(generarEtiquetaRouter);

// 9. Catch-all para frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 10. Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});