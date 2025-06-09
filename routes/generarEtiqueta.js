const express = require('express');
const router = express.Router();
const generarEtiqueta = require('../generarEtiqueta');

// POST /generar-etiqueta
router.post('/', async (req, res) => {
  // Este log mostrará SOLO el JSON enviado por el cliente
  console.log('BODY EN EL ROUTER:', req.body);

  try {
    const result = await generarEtiqueta(req.body); // <-- ¡Solo pasamos req.body!
    res.json(result);
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

module.exports = router;