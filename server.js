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
// DEPURACIÓN: Puedes POSTEAR a /debug-body para ver el body recibido
app.post('/debug-body', (req, res) => {
  return res.json({ recibido: req.body });
});

app.post('/generar-etiqueta', async (req, res) => {
  // Validación robusta y soporte para crear order_id si solo viene offer_history_id
  function checkAddress(addr) {
    return (
      addr &&
      addr.name && addr.street1 && addr.city &&
      addr.state && addr.zip && addr.country && addr.email
    );
  }

  function checkParcel(parcel) {
    return (
      parcel &&
      parcel.length && parcel.width && parcel.height && parcel.weight
    );
  }

  try {
    // Permite parcel directo o por campos sueltos
    const toAddress = req.body.to_address;
    const fromAddress = req.body.from_address;
    const parcel = req.body.parcel || {
      length: req.body.length,
      width: req.body.width,
      height: req.body.height,
      weight: req.body.weight,
    };
    const direction = req.body.direction || "to_icellshop";

    // Validación explícita
    if (!checkAddress(toAddress)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto to_address', body: req.body });
    }
    if (!checkAddress(fromAddress)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto from_address', body: req.body });
    }
    if (!checkParcel(parcel)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto parcel', body: req.body });
    }

    // Soporta order_id o crea la orden si solo viene offer_history_id
    let orderId = req.body.order_id || null;
    const offerHistoryId = req.body.offer_history_id || null;
    let orderResult = null;

    if (!orderId && offerHistoryId) {
  try {
    orderResult = await pool.query(
      `INSERT INTO orders (
        offer_history_id, status, tracking_code, label_url, shipped_at, received_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, now(), now()) RETURNING *`,
      [
        offerHistoryId,
        'awaiting_shipment',
        tracking_code,                              // <-- Debes tener tracking_code definido antes de este insert
        shipment.postage_label ? shipment.postage_label.label_url : null, // <-- lo mismo para shipment
        null,                                       // shipped_at
        null                                        // received_at
      ]
    );
    if (orderResult && orderResult.rows && orderResult.rows[0]) {
      orderId = orderResult.rows[0].id;
    }
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: 'No se pudo registrar la orden en la base de datos.',
      error: err.message,
      details: err.detail || null
    });
  }
}

    if (!orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'No se pudo crear ni obtener order_id (falta offer_history_id o error en DB)'
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