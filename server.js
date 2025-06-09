const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON y URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === Crear la carpeta public/pdfs si no existe ===
const pdfsDir = path.join(__dirname, 'public', 'pdfs');
if (!fs.existsSync(pdfsDir)) {
  fs.mkdirSync(pdfsDir, { recursive: true });
}

// === Servir la carpeta public/pdfs de forma pública ===
app.use('/pdfs', express.static(pdfsDir));

// ==== API para validar dirección con Google ====
app.post('/validar-direccion', async (req, res) => {
  // LOG para ver qué recibe el backend
  console.log("Body recibido en /validar-direccion:", req.body);

  let address = req.body.address;

  // Si el frontend manda los campos separados, también los acepta:
  if (!address) {
    const { street1, street2, city, state, zip } = req.body;
    if (!street1 || !city || !state || !zip) {
      return res.status(400).json({ error: 'Faltan campos de dirección' });
    }
    // Agrega country US al final para mejor precisión
    address = `${street1}, ${street2 ? street2 + ', ' : ''}${city}, ${state}, ${zip}, US`;
  }

  // LOG para ver la dirección exacta que se envía a Google
  console.log("Validando dirección (enviada a Google):", address);

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: apiKey }
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      return res.json({ status: 'valid', datos: response.data.results[0] });
    } else {
      return res.json({ status: 'invalid', message: 'Dirección no encontrada' });
    }
  } catch (error) {
    console.error('Error al consultar Google:', error);
    return res.status(500).json({ error: 'Error al consultar Google' });
  }
});

// ==== API para validar dirección con EasyPost ====
app.post('/direccion-easypost', async (req, res) => {
  // LOG para ver qué recibe el backend
  console.log("Body recibido en /direccion-easypost:", req.body);

  const { street1, street2, city, state, zip } = req.body;
  const country = "US";
  try {
    const body = {
      address: { street1, street2, city, state, zip, country },
      verify: ['delivery']
    };

    // LOG para ver exactamente qué se envía a EasyPost
    console.log("Enviando a EasyPost:", JSON.stringify(body, null, 2));

    const epRes = await fetch('https://api.easypost.com/v2/addresses', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(process.env.EASYPOST_API_KEY + ':').toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await epRes.json();

    if (data.verifications && data.verifications.delivery && data.verifications.delivery.success) {
      res.json({ status: 'valid', address: data });
    } else if (
      data.verifications &&
      data.verifications.delivery &&
      data.verifications.delivery.suggestions &&
      data.verifications.delivery.suggestions.length
    ) {
      res.json({
        status: 'suggestion',
        suggestion: data.verifications.delivery.suggestions[0],
        message: 'Dirección no válida, pero se sugiere una corrección.'
      });
    } else {
      let message = 'No se pudo verificar la dirección. ';
      if (data.verifications && data.verifications.delivery && data.verifications.delivery.errors) {
        message += data.verifications.delivery.errors.map(e => e.message).join(', ');
      }
      res.json({ status: 'invalid', message });
    }
  } catch (err) {
    console.error('Error validando dirección con EasyPost:', err);
    res.json({ status: 'error', message: 'Error validando dirección.' });
  }
});

// ==== API para generar PDF ====
app.post('/generar-pdf', async (req, res) => {
  const { content, filename } = req.body;
  if (!content || !filename) {
    return res.status(400).json({ error: 'Faltan datos: content y filename' });
  }

  const filePath = path.join(pdfsDir, filename);
  fs.writeFileSync(filePath, content);

  res.json({ url: `/pdfs/${filename}` });
});

// ==== API para descargar PDF ====
app.get('/descargar/:pdf', (req, res) => {
  const pdfName = req.params.pdf;
  const filePath = path.join(pdfsDir, pdfName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('PDF no encontrado');
  }
  res.download(filePath);
});

// ==== SERVIR TU FRONTEND ====
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));
app.get(/^\/(?!pdfs\/|generar-pdf$|descargar\/|direccion-easypost$|validar-direccion$).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// INICIAR SERVIDOR
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});

// Node < 18 necesita este fetch, si no tienes fetch global, descomenta:
// const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
