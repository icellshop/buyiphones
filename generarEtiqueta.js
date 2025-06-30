const express = require('express');
const axios = require('axios');
const EasyPost = require('@easypost/api');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const sendLabelEmail = require('../mailgun-send');
const { imageToPDF } = require('../mailgun-send');

const api = new EasyPost(process.env.EASYPOST_API_KEY);
const pool = require('../db');

const router = express.Router();

// DEPURACIÓN: Responde con lo que recibe
router.post('/debug-body', (req, res) => {
  return res.json({ recibido: req.body });
});

// Funciones de validación
function checkAddress(addr) {
  return (
    addr &&
    addr.name && addr.street1 && addr.city &&
    addr.state && addr.zip && addr.country && addr.email
  );
}

function checkParcel(parcel) {
  return (
    parcel &&
    parcel.length && parcel.width && parcel.height && parcel.weight
  );
}

// Endpoint para generar etiqueta
router.post('/generar-etiqueta', async (req, res) => {
  try {
    // DEPURACIÓN: Muestra lo recibido en Render (usa /debug-body si no ves logs)
    // console.log('[generar-etiqueta] Payload:', JSON.stringify(req.body, null, 2));

    const toAddress = req.body.to_address;
    const fromAddress = req.body.from_address;
    const parcel = req.body.parcel || {
      length: req.body.length,
      width: req.body.width,
      height: req.body.height,
      weight: req.body.weight,
    };

    // Validación explícita con mensaje claro
    if (!checkAddress(toAddress)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto to_address', body: req.body });
    }
    if (!checkAddress(fromAddress)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto from_address', body: req.body });
    }
    if (!checkParcel(parcel)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto parcel', body: req.body });
    }

    // Crear etiqueta EasyPost
    let shipment = await api.Shipment.create({
      to_address: toAddress,
      from_address: fromAddress,
      parcel: parcel,
    });

    let rate = (shipment && shipment.rates && shipment.rates[0]) ? shipment.rates[0] : null;
    if (!rate) throw new Error('No se encontraron rates para el envío');
    shipment = await api.Shipment.buy(shipment.id, rate);

    const selectedRate = shipment.selected_rate || rate;
    const shipment_cost = selectedRate ? Number(selectedRate.rate) : null;
    const shipment_currency = selectedRate ? selectedRate.currency : null;
    const tracking_code = shipment.tracking_code;
    const shipment_id = shipment.id;
    const status = shipment.status;
    const carrier = selectedRate.carrier;
    const carrier_service = selectedRate.service;
    const public_url = shipment.postage_label ? shipment.postage_label.label_url : null;
    const direction = req.body.direction || "to_icellshop";

    // PDF + correo
    const destinatario = toAddress.email || req.body.contacto;
    const labelUrl = shipment.postage_label.label_url;
    const subject = 'Tu etiqueta de envío de ICellShop';
    const text = 'Adjuntamos la etiqueta de tu envío. Imprímela y colócala en el paquete.';
    const pdfPath = await imageToPDF(labelUrl);
    const publicPath = path.join(__dirname, '..', 'public', 'tmp');
    if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath, { recursive: true });
    const pdfFileName = `etiqueta_${Date.now()}.pdf`;
    const finalPdfPath = path.join(publicPath, pdfFileName);
    fs.copyFileSync(pdfPath, finalPdfPath);
    fs.unlinkSync(pdfPath);
    try { await sendLabelEmail(destinatario, subject, text, finalPdfPath); } catch (err) { console.error('Error enviando correo:', err); }

    // --- Lógica de orden y tracking ---
    let order_id = req.body.order_id || null;
    const offerHistoryId = req.body.offer_history_id || null;
    let orderResult = null;

    // Si no hay order_id pero sí offer_history_id, crea la orden
    if (!order_id && offerHistoryId) {
      try {
        orderResult = await pool.query(
          `INSERT INTO orders (
            offer_history_id, status, tracking_code, label_url, shipped_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING *`,
          [
            offerHistoryId,
            'awaiting_shipment',
            tracking_code,
            shipment.postage_label.label_url,
            null
          ]
        );
        if (orderResult && orderResult.rows && orderResult.rows[0]) {
          order_id = orderResult.rows[0].id;
        }
      } catch (err) {
        return res.status(500).json({
          status: 'error',
          message: 'No se pudo registrar la orden en la base de datos.',
          error: err.message,
          details: err.detail || null
        });
      }
    }

    // Si no existe order_id ni offer_history_id, error
    if (!order_id) {
      return res.status(400).json({
        status: 'error',
        message: 'No se pudo crear ni obtener order_id (falta offer_history_id o error en DB)'
      });
    }

    // Insertar en trackings con cost/currency/direction
    try {
      await pool.query(
        `INSERT INTO trackings (
          order_id, tracking_code, status, carrier, shipment_id,
          carrier_service, public_url, shipment_cost, shipment_currency, direction, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
        ON CONFLICT (tracking_code) DO UPDATE SET
          order_id = EXCLUDED.order_id,
          status = EXCLUDED.status,
          carrier = EXCLUDED.carrier,
          shipment_id = EXCLUDED.shipment_id,
          carrier_service = EXCLUDED.carrier_service,
          public_url = EXCLUDED.public_url,
          shipment_cost = EXCLUDED.shipment_cost,
          shipment_currency = EXCLUDED.shipment_currency,
          direction = EXCLUDED.direction,
          updated_at = now()
        `,
        [
          order_id,
          tracking_code,
          status,
          carrier,
          shipment_id,
          carrier_service,
          public_url,
          shipment_cost,
          shipment_currency,
          direction
        ]
      );
    } catch (err) {
      // Si esto falla, igual responde, pero informa
      return res.status(500).json({ status: 'error', message: 'Error insertando tracking', error: err.message });
    }

    // Actualiza el total_shipping_cost en orders
    if (order_id) {
      try {
        await pool.query(
          `UPDATE orders
           SET total_shipping_cost = (
             SELECT COALESCE(SUM(shipment_cost),0) FROM trackings WHERE order_id = $1
           )
           WHERE id = $1`,
          [order_id]
        );
      } catch (err) {
        // No aborta, solo loguea
        console.error('Error al actualizar total_shipping_cost en orders:', err.message);
      }
    }

    res.json({
      status: 'success',
      label_url: labelUrl,
      tracking_code: tracking_code || null,
      shipment,
      order: orderResult && orderResult.rows ? orderResult.rows[0] : null,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error generando etiqueta',
      details: error.message,
    });
  }
});

module.exports = router;