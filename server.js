const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

// Importa tu función de generación de etiquetas (ajusta el path si es necesario)
const generarEtiqueta = require('./generarEtiqueta');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(bodyParser.json());

// Hacer pública la carpeta /public/pdfs (¡asegúrate de que exista!)
app.use('/pdfs', express.static(path.join(__dirname, 'public', 'pdfs')));

// Ruta básica de prueba
app.get('/', (req, res) => {
  res.send('¡Servidor Express en línea y PDFs públicos!');
});

// Endpoint para generar la etiqueta
app.post('/api/generar-etiqueta', async (req, res) => {
  try {
    const resultado = await generarEtiqueta(req.body);
    // Añade la URL pública del PDF generado, si tu función la devuelve
    if (resultado && resultado.pdfFileName) {
      resultado.download_url = `${req.protocol}://${req.get('host')}/pdfs/${resultado.pdfFileName}`;
    }
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message || 'Error desconocido' });
  }
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});