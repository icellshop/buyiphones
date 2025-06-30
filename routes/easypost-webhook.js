const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db'); // Ajusta el path si es distinto
const EASYPOST_SECRET = process.env.EASYPOST_WEBHOOK_SECRET;

// Middleware para capturar el raw body
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) req.rawBody = buf.toString(encoding || 'utf8');
};
router.use(express.json({ verify: rawBodySaver }));

router.post('/api/easypost-webhook', async (req, res) => {
  try {
    const signature = req.headers['x-hmac-signature'];
    if (!signature || !EASYPOST_SECRET) {
      return res.status(401).send('Missing signature or secret');
    }
    const expected = 'hmac-sha256-hex=' + crypto
      .createHmac('sha256', EASYPOST_SECRET)
      .update(req.rawBody)
      .digest('hex');
    if (signature !== expected) {
      console.warn('Invalid EasyPost HMAC signature');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;

    if (
      event.object === "Event" &&
      event.result &&
      (event.result.object === 'Tracker' || event.result.object === 'Shipment')
    ) {
      const r = event.result;

      const tracking_code = r.tracking_code;
      const status = r.status;
      const status_detail = r.status_detail;
      const carrier = r.carrier;
      const shipment_id = r.shipment_id;
      const public_url = r.public_url;
      const signed_by = r.signed_by;
      const is_return = r.is_return;
      const finalized = r.finalized;
      const est_delivery_date = r.est_delivery_date;
      const weight = r.weight;
      const created_at = r.created_at ? new Date(r.created_at) : null;
      const updated_at = r.updated_at ? new Date(r.updated_at) : null;
      const tracking_details = r.tracking_details ? JSON.stringify(r.tracking_details) : null;
      const carrier_service = r.carrier_detail?.service || null;
      const carrier_origin = r.carrier_detail?.origin_location || null;
      const carrier_destination = r.carrier_detail?.destination_location || null;
      const shipment_cost = r.selected_rate?.rate ? Number(r.selected_rate.rate) : null;
      const shipment_currency = r.selected_rate?.currency || null;

      // Busca el order_id si tu tabla orders tiene tracking_code
      let order_id = null;
      try {
        const orderRes = await pool.query(`SELECT id FROM orders WHERE tracking_code = $1`, [tracking_code]);
        if (orderRes.rows.length > 0) order_id = orderRes.rows[0].id;
      } catch (e) {
        // Si no tienes orders, puedes omitir esto
      }

      // UPSERT en trackings
      await pool.query(
        `INSERT INTO trackings (
          order_id, tracking_code, status, status_detail, carrier, shipment_id, public_url,
          signed_by, is_return, finalized, est_delivery_date, weight, carrier_service,
          carrier_origin, carrier_destination, created_at, updated_at, tracking_details,
          shipment_cost, shipment_currency
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18,
          $19, $20
        )
        ON CONFLICT (tracking_code) DO UPDATE SET
          order_id = EXCLUDED.order_id,
          status = EXCLUDED.status,
          status_detail = EXCLUDED.status_detail,
          carrier = EXCLUDED.carrier,
          shipment_id = EXCLUDED.shipment_id,
          public_url = EXCLUDED.public_url,
          signed_by = EXCLUDED.signed_by,
          is_return = EXCLUDED.is_return,
          finalized = EXCLUDED.finalized,
          est_delivery_date = EXCLUDED.est_delivery_date,
          weight = EXCLUDED.weight,
          carrier_service = EXCLUDED.carrier_service,
          carrier_origin = EXCLUDED.carrier_origin,
          carrier_destination = EXCLUDED.carrier_destination,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          tracking_details = EXCLUDED.tracking_details,
          shipment_cost = EXCLUDED.shipment_cost,
          shipment_currency = EXCLUDED.shipment_currency
        `,
        [
          order_id, tracking_code, status, status_detail, carrier, shipment_id, public_url,
          signed_by, is_return, finalized, est_delivery_date, weight, carrier_service,
          carrier_origin, carrier_destination, created_at, updated_at, tracking_details,
          shipment_cost, shipment_currency
        ]
      );

      console.log(`[EasyPost] Tracking actualizado: ${tracking_code} - ${status}`);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error en webhook EasyPost:', err);
    res.status(500).send('Internal Error');
  }
});

module.exports = router;