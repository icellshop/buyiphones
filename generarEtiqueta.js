const express = require('express');
const axios = require('axios');
const EasyPost = require('@easypost/api');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const sendLabelEmail = require('./mailgun-send');
const { imageToPDF } = require('./mailgun-send'); // asegúrate de exportar esto en mailgun-send.js

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

// Endpoint para generar etiqueta con EasyPost y enviar por email y devolver PDF como link
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

    // Crea el envío en EasyPost
    const shipment = await api.Shipment.create({
      to_address: toAddress,
      from_address: fromAddress,
      parcel: parcel,
    });

    // Email del destinatario y URL de la etiqueta (PNG normalmente)
    const destinatario = toAddress.email;
    const labelUrl = shipment.postage_label.label_url;
    const subject = 'Tu etiqueta de envío de ICellShop';
    const text = 'Adjuntamos la etiqueta de tu envío. Imprímela y colócala en el paquete.';

    // 1. Genera PDF temporal desde la imagen (PNG)
    const pdfPath = await imageToPDF(labelUrl);

    // 2. Copia a una carpeta pública para servirlo (por ejemplo, public/tmp/)
    const publicPath = path.join(__dirname, 'public', 'tmp');
    if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath, { recursive: true });
    const pdfFileName = `etiqueta_${Date.now()}.pdf`;
    const finalPdfPath = path.join(publicPath, pdfFileName);
    fs.copyFileSync(pdfPath, finalPdfPath);

    // 3. Borra el archivo temporal creado por imageToPDF
    fs.unlinkSync(pdfPath);

    // 4. Crea la URL pública (asumiendo que sirves /public como estático y /tmp es accesible)
    const labelPdfUrl = `/tmp/${pdfFileName}`;

    // 5. Envía el correo con el PDF adjunto (finalPdfPath)
    try {
      await sendLabelEmail(destinatario, subject, text, finalPdfPath);
      console.log('Correo enviado a', destinatario);
    } catch (err) {
      console.error('Error enviando correo:', err);
      // Si falla el correo, igual devuelve la etiqueta por respuesta
    }

    res.json({
      status: 'success',
      label_url: labelPdfUrl,  // Ahora es PDF
      tracking_code: shipment.tracking_code,
      shipment,
    });
  } catch (error) {
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
