const express = require('express');
const router = express.Router();
const pool = require('./db');

router.get('/api/offers-catalog', async (req, res) => {
  try {
    // Solo selecciona las ofertas activas
    const result = await pool.query('SELECT * FROM offers_catalog WHERE active = TRUE');
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;