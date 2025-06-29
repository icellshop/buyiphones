const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db'); // Tu pool de Postgres

const EASYPOST_SECRET = process.env.EASYPOST_WEBHOOK_SECRET;

// Middleware para capturar el raw body
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};
router.use(express.json({ verify: rawBodySaver }));

router.post('/api/easypost-webhook', async (req, res) => {
  try {
    // 1. Verifica la firma HMAC (EasyPost usa SHA256 HEX, con prefijo)
    const signature = req.headers['x-hmac-signature'];
    if (!signature || !EASYPOST_SECRET) {
      return res.status(401).send('Missing signature or secret');
    }
    // La firma debe ser comparada como string hex con prefijo
    const expected = 'hmac-sha256-hex=' + crypto
      .createHmac('sha256', EASYPOST_SECRET)
      .update(req.rawBody)
      .digest('hex');

    if (signature !== expected) {
      console.warn('Invalid EasyPost HMAC signature');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;

    // Solo acepta eventos tracker.updated o shipment.updated
    if (
      (event.object === "Event" && event.result && event.result.object === 'Tracker') ||
      (event.object === "Event" && event.result && event.result.object === 'Shipment')
    ) {
      let tracking_code = event.result.tracking_code;
      let status = event.result.status; // Ejemplo: 'in_transit', 'delivered', etc.

      if (tracking_code && status) {
        await pool.query(
          `UPDATE orders SET status = $1, updated_at = now() WHERE tracking_code = $2`,
          [status, tracking_code]
        );
        console.log(`[EasyPost] Orden ${tracking_code} actualizada a status: ${status}`);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error en webhook EasyPost:', err);
    res.status(500).send('Internal Error');
  }
});

module.exports = router;