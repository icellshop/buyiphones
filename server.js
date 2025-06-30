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

// 1. SOLO EL WEBHOOK SIN json() ANTES (para poder usar rawBody en easypostWebhook)
app.use('/api/easypost-webhook', easypostWebhook);

// 2. Ahora sí, el resto del middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Resto de routers
app.use(offersCatalogRouter);
if (mailgunRouter) app.use(mailgunRouter);

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

// 8. Endpoint para generar etiqueta (ahora insertando en trackings)
app.post('/generar-etiqueta', async (req, res) => {
  try {
    const toAddress = req.body.to_address;
    const fromAddress = req.body.from_address;
    const parcel = req.body.parcel;
    const orderId = req.body.order_id; // Debe venir del frontend o asociarse de alguna manera
    const direction = req.body.direction || "to_icellshop"; // "return_to_sender" para devoluciones

    if (!toAddress || !fromAddress || !parcel || !orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Faltan campos obligatorios: to_address, from_address, parcel u order_id'
      });
    }

    // Crear el shipment
    let shipment = await api.Shipment.create({
      to_address: toAddress,
      from_address: fromAddress,
      parcel: parcel,
    });

    // Selecciona la tarifa más barata disponible (o la primera)
    const rate = shipment.rates && shipment.rates.length > 0 ? shipment.rates[0] : null;

    if (!rate) {
      return res.status(400).json({
        status: 'error',
        message: 'No se encontraron tarifas disponibles para el envío',
        details: shipment
      });
    }

    // COMPRA la etiqueta usando el método correcto según la documentación
    shipment = await api.Shipment.buy(shipment.id, rate);

    // Calcula costos
    const selectedRate = shipment.selected_rate || rate;
    const shipment_cost = selectedRate ? Number(selectedRate.rate) : null;
    const shipment_currency = selectedRate ? selectedRate.currency : null;

    // Debug log antes del insert
    console.log('Antes de insertar en trackings:', {
      shipment_cost,
      shipment_currency,
      orderId,
      tracking_code: shipment.tracking_code,
      labelUrl: shipment.postage_label.label_url
    });

    // --- ENVÍA EL CORREO AUTOMATICAMENTE ---
    let emailResult = null;
    try {
      const destinatario = toAddress.email || req.body.contacto;
      if (!destinatario) throw new Error("No se encontró email de destinatario para enviar la etiqueta.");

      const asunto = "Tu etiqueta de envío ICellShop";
      const texto = "Adjuntamos tu etiqueta para enviar el paquete a ICellShop. Imprímela y pégala en tu paquete.";

      if (shipment.postage_label && shipment.postage_label.label_url) {
        emailResult = await sendLabelEmail(destinatario, asunto, texto, shipment.postage_label.label_url);
      }
    } catch (mailError) {
      emailResult = { error: true, details: mailError.message };
    }

    // REGISTRA EL TRACKING EN LA BASE DE DATOS
    let trackingResult = null;
    try {
      trackingResult = await pool.query(
        `INSERT INTO trackings (
            order_id, tracking_code, status, carrier, shipment_id, carrier_service, public_url,
            shipment_cost, shipment_currency, direction, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
          RETURNING *`,
        [
          orderId,
          shipment.tracking_code,
          shipment.status,
          shipment.carrier,
          shipment.id,
          selectedRate && selectedRate.service ? selectedRate.service : null,
          shipment.postage_label && shipment.postage_label.label_url ? shipment.postage_label.label_url : null,
          shipment_cost,
          shipment_currency,
          direction
        ]
      );
    } catch (err) {
      console.error('Error al registrar el tracking en DB:', err.message);
    }

    // Actualiza el total_shipping_cost en orders
    try {
      await pool.query(
        `UPDATE orders
         SET total_shipping_cost = (
           SELECT COALESCE(SUM(shipment_cost),0) FROM trackings WHERE order_id = $1
         )
         WHERE id = $1
        `,
        [orderId]
      );
    } catch (err) {
      console.error('Error al actualizar total_shipping_cost en orders:', err.message);
    }

    res.json({
      status: 'success',
      label_url: shipment.postage_label ? shipment.postage_label.label_url : null,
      tracking_code: shipment.tracking_code || null,
      shipment,
      tracking: trackingResult && trackingResult.rows ? trackingResult.rows[0] : null,
      email_result: emailResult
    });
  } catch (error) {
    console.error('EasyPost error:', error);

    let msg = error.message;
    if (error.errors) msg = JSON.stringify(error.errors);
    if (error.response && error.response.body) {
      msg = error.response.body.error || JSON.stringify(error.response.body);
    }
    res.status(500).json({
      status: 'error',
      message: 'Error generando etiqueta',
      details: msg,
    });
  }
});

// 9. Catch-all para frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 10. Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});