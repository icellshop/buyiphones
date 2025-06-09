const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON y URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir carpeta de PDFs de forma pública
// Puedes acceder a los PDFs con: https://TU-APP.onrender.com/pdfs/nombre.pdf
app.use('/pdfs', express.static(path.join(__dirname, 'pdfs')));

// Ruta de inicio simple
app.get('/', (req, res) => {
  res.send('¡Servidor Express en línea y PDFs públicos!');
});

// Ejemplo de endpoint para generar un PDF (placeholder, adapta a tu lógica)
app.post('/generar-pdf', async (req, res) => {
  const { content, filename } = req.body;

  if (!content || !filename) {
    return res.status(400).json({ error: 'Faltan datos: content y filename' });
  }

  // Aquí deberías generar el PDF usando tu librería preferida (ej: pdfkit, puppeteer, etc).
  // Este es un ejemplo que solo guarda el texto como .txt para ilustrar:
  const pdfsDir = path.join(__dirname, 'pdfs');
  if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir);

  const filePath = path.join(pdfsDir, filename);
  fs.writeFileSync(filePath, content);

  res.json({ url: `/pdfs/${filename}` });
});

// Endpoint para descargar un PDF específico (descarga forzada)
app.get('/descargar/:pdf', (req, res) => {
  const pdfName = req.params.pdf;
  const filePath = path.join(__dirname, 'pdfs', pdfName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('PDF no encontrado');
  }

  res.download(filePath);
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});
