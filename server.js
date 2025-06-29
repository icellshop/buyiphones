const express = require('express');
const axios = require('axios');
const path = require('path');
const EasyPost = require('@easypost/api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const api = new EasyPost(process.env.EASYPOST_API_KEY);
const sendLabelEmail = require('./mailgun-send');
const sendContactRouter = require('./api-send-contact');

app.use(sendContactRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos de la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

app.get('/env.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = { OFFERS_ENDPOINT: "${process.env.OFFERS_ENDPOINT}" };`);
});


// Ruta para /sell-device que sirve selldevice.html
app.get('/sell-device', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'selldevice.html'));
});

// Ruta para Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// Ruta para Contact
app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});
// Ruta para who are we
app.get('/we-are', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'we-are.html'));
});

// Ruta para wholesale
app.get('/wholesale', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wholesale.html'));
});

// (opcional) Redirección para /index.html
app.get('/index.html', (req, res) => {
  res.redirect('/');
});

app.use('/tmp', express.static(path.join(__dirname, 'public', 'tmp')));

// Endpoint para validar dirección con Google Geocoding API
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

// Endpoint para generar etiqueta con EasyPost (COMPRA la etiqueta y retorna el PDF)
app.post('/generar-etiqueta', async (req, res) => {
  try {
    const toAddress = req.body.to_address;
    const fromAddress = req.body.from_address;
    const parcel = req.body.parcel;

    if (!toAddress || !fromAddress || !parcel) {
      return res.status(400).json({
        status: 'error',
        message: 'Faltan campos obligatorios: to_address, from_address o parcel'
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

    // --- ENVÍA EL CORREO AUTOMATICAMENTE ---
    let emailResult = null;
    try {
      // El email DEBE estar en toAddress.email, si no, busca en req.body.contacto como fallback
      const destinatario = toAddress.email || req.body.contacto;
      if (!destinatario) throw new Error("No se encontró email de destinatario para enviar la etiqueta.");

      const asunto = "Tu etiqueta de envío ICellShop";
      const texto = "Adjuntamos tu etiqueta para enviar el paquete a ICellShop. Imprímela y pégala en tu paquete.";

      if (shipment.postage_label && shipment.postage_label.label_url) {
        emailResult = await sendLabelEmail(destinatario, asunto, texto, shipment.postage_label.label_url);
      }
    } catch (mailError) {
      // Si falla el envío de email, sigue funcionando pero avisa en el response
      emailResult = { error: true, details: mailError.message };
    }

    res.json({
      status: 'success',
      label_url: shipment.postage_label ? shipment.postage_label.label_url : null,
      tracking_code: shipment.tracking_code || null,
      shipment, // Incluye todo el objeto shipment por si necesitas más info en el frontend
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

// Catch-all para frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar el servidor SIEMPRE en process.env.PORT
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});
