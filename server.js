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
  let address = req.body.address;

  // Si el frontend manda los campos separados, también los acepta:
  if (!address) {
    const { street1, street2, city, state, zip } = req.body;
    if (!street1 || !city || !state || !zip) {
      return res.status(400).json({ error: 'Faltan campos de dirección' });
    }
    address = `${street1}, ${street2 ? street2 + ', ' : ''}${city}, ${state}, ${zip}`;
  }

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
    return res.status(500).json({ error: 'Error al consultar Google' });
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
app.get(/^\/(?!pdfs\/|generar-pdf$|descargar\/).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// INICIAR SERVIDOR
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});
