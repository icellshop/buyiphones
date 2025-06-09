const express = require('express');
const axios = require('axios');
const path = require('path');
const EasyPost = require('@easypost/api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializa tu instancia de EasyPost API
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

// Endpoint para generar etiqueta con EasyPost
app.post('/generar-etiqueta', async (req, res) => {
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

// Ruta catch-all para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});
