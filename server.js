const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // <-- Nuevo
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
  const { address } = req.body;
  if (!address) {
    return res.status(400).json({ error: 'Falta el campo address' });
  }

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address,
        key: apiKey,
      },
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      // Dirección válida
      return res.json({ valido: true, datos: response.data.results[0] });
    } else {
      // Dirección inválida
      return res.json({ valido: false, error: 'Dirección no encontrada' });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar Google' });
  }
});

// ==== API para generar PDF (simple ejemplo, puedes usar pdfkit o similar para PDF real) ====
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

// Cambia 'public' si tu carpeta de frontend tiene otro nombre
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));

// Para cualquier ruta que NO sea /pdfs ni /generar-pdf ni /descargar, devuelve index.html (SPA)
app.get(/^\/(?!pdfs\/|generar-pdf$|descargar\/).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// INICIAR SERVIDOR
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});
