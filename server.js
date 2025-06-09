const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sirve archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint de API
app.post('/validar-direccion', async (req, res) => {
  // ... tu código aquí ...
});

// Ruta catch-all para SPA (debe ir al final)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en puerto ${PORT}`);
});
