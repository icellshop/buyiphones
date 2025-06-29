const express = require('express');
const router = express.Router();
const pool = require('./db');

// Usa un prefijo de ruta para mantener la API limpia (opcional pero recomendado)
router.post('/api/register-offer', async (req, res) => {
  const { offer_id, email, ip_address } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO offers_history (offer_id, email, ip_address) VALUES ($1, $2, $3) RETURNING *`,
      [offer_id, email, ip_address]
    );
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;