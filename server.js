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
app.use('/pdfs', express.static(path.join(__dirname, 'pdfs')));

// ==== TUS APIS van aquí ====

app.post('/generar-pdf', async (req, res) => {
  const { content, filename } = req.body;
  if (!content || !filename) return res.status(400).json({ error: 'Faltan datos: content y filename' });

  const pdfsDir = path.join(__dirname, 'pdfs');
  if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir);
  const filePath = path.join(pdfsDir, filename);
  fs.writeFileSync(filePath, content);

  res.json({ url: `/pdfs/${filename}` });
});

app.get('/descargar/:pdf', (req, res) => {
  const pdfName = req.params.pdf;
  const filePath = path.join(__dirname, 'pdfs', pdfName);
  if (!fs.existsSync(filePath)) return res.status(404).send('PDF no encontrado');
  res.download(filePath);
});

// ==== SERVIR TU FRONTEND ====

const frontendPath = path.join(__dirname, 'build'); // Cambia 'build' si tu carpeta es diferente

// Servir archivos estáticos de la build del frontend
app.use(express.static(frontendPath));

// Para cualquier ruta que NO sea /pdfs ni /generar-pdf ni /descargar, devuelve index.html (SPA)
app.get('*', (req, res) => {
  // Evitar conflicto con rutas de APIs o PDFs
  if (
    req.path.startsWith('/pdfs') ||
    req.path.startsWith('/generar-pdf') ||
    req.path.startsWith('/descargar')
  ) {
    return res.status(404).end();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// INICIAR SERVIDOR
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});
