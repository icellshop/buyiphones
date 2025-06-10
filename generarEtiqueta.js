const express = require('express');
const axios = require('axios');
const EasyPost = require('@easypost/api');
require('dotenv').config();

const sendLabelEmail = require('./mailgun-send');

// Inicializa tu instancia de EasyPost API
const api = new EasyPost(process.env.EASYPOST_API_KEY);

const router = express.Router();

// Endpoint para validar dirección con Google Geocoding API
router.post('/validar-direccion', async (req, res) => {
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

// Endpoint para generar etiqueta con EasyPost y enviar por email
router.post('/generar-etiqueta', async (req, res) => {
  try {
    // Filtra solo los campos permitidos para EasyPost
    const toAddress = {
      name: req.body.to_address.name,
      street1: req.body.to_address.street1,
      street2: req.body.to_address.street2,
      city: req.body.to_address.city,
      state: req.body.to_address.state,
      zip: req.body.to_address.zip,
      country: req.body.to_address.country || 'US',
      phone: req.body.to_address.phone,
      email: req.body.to_address.email,
    };

    const fromAddress = {
      name: req.body.from_address.name,
      street1: req.body.from_address.street1,
      street2: req.body.from_address.street2,
      city: req.body.from_address.city,
      state: req.body.from_address.state,
      zip: req.body.from_address.zip,
      country: req.body.from_address.country || 'US',
      phone: req.body.from_address.phone,
      email: req.body.from_address.email,
    };

    const parcel = {
      length: req.body.length,
      width: req.body.width,
      height: req.body.height,
      weight: req.body.weight,
    };

    // Solo envía los campos válidos. NO agregues payment_value ni payment_method ni ningún otro campo personalizado.
    const shipment = await api.Shipment.create({
      to_address: toAddress,
      from_address: fromAddress,
      parcel: parcel,
      // Puedes agregar otros campos válidos de EasyPost aquí si lo necesitas, pero nunca campos personalizados.
    });

    // Toma el email y la url de la etiqueta
    const destinatario = toAddress.email; // O usa otro campo si quieres enviar a un admin
    const labelUrl = shipment.postage_label.label_url;
    const subject = 'Tu etiqueta de envío de ICellShop';
    const text = 'Adjuntamos la etiqueta de tu envío. Imprímela y colócala en el paquete.';

    // Envía el correo con la etiqueta adjunta (PDF)
    try {
      await sendLabelEmail(destinatario, subject, text, labelUrl);
      console.log('Correo enviado a', destinatario);
    } catch (err) {
      console.error('Error enviando correo:', err);
      // Si falla el correo, igual devuelve la etiqueta por respuesta
      // Puedes decidir si quieres marcar esto como error o no
    }

    res.json({
      status: 'success',
      shipment,
    });
  } catch (error) {
    // Intenta parsear el error de EasyPost
    let msg = error.message;
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

module.exports = router;
