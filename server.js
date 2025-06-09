const express = require('express');
const axios = require('axios');
const path = require('path');
const EasyPost = require('@easypost/api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const api = new EasyPost(process.env.EASYPOST_API_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos de la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

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

    // Selecciona la tarifa más barata disponible (o la primera, según tu lógica)
    const rate = shipment.rates && shipment.rates.length > 0 ? shipment.rates[0] : null;

    if (!rate) {
      return res.status(400).json({
        status: 'error',
        message: 'No se encontraron tarifas disponibles para el envío',
        details: shipment
      });
    }

    // Comprar la etiqueta (obligatorio para obtener el PDF)
    shipment = await shipment.buy(rate);

    // Devuelve el link directo al PDF y el tracking code
    res.json({
      status: 'success',
      label_url: shipment.postage_label ? shipment.postage_label.label_url : null,
      tracking_code: shipment.tracking_code || null,
      shipment, // Incluye todo el objeto shipment por si necesitas más info en el frontend
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

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});
