const express = require('express');
const EasyPost = require('@easypost/api');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { sendLabelEmail, imageToPDF } = require('./mailgun-send');
const pool = require('./db');

const api = new EasyPost(process.env.EASYPOST_API_KEY);
const router = express.Router();

// Validadores
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

// Endpoint para generar etiqueta y registrar orden/tracking
router.post('/generar-etiqueta', async (req, res) => {
  try {
    const toAddress = req.body.to_address;
    const fromAddress = req.body.from_address;
    const parcel = req.body.parcel || {
      length: req.body.length,
      width: req.body.width,
      height: req.body.height,
      weight: req.body.weight,
    };
    const direction = req.body.direction || "to_icellshop";
    let orderId = req.body.order_id || null;
    const offerHistoryId = req.body.offer_history_id || null;
    let orderResult = null;

    // Validación
    if (!checkAddress(toAddress)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto to_address', body: req.body });
    }
    if (!checkAddress(fromAddress)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto from_address', body: req.body });
    }
    if (!checkParcel(parcel)) {
      return res.status(400).json({ status: 'error', message: 'Falta o está incompleto parcel', body: req.body });
    }

    // 1. Crear shipment y obtener tracking_code, label_url
    let shipment = await api.Shipment.create({
      to_address: toAddress,
      from_address: fromAddress,
      parcel: parcel,
    });
    const rate = shipment.rates && shipment.rates.length > 0 ? shipment.rates[0] : null;
    if (!rate) throw new Error('No se encontraron tarifas disponibles para el envío');
    shipment = await api.Shipment.buy(shipment.id, rate);

    // Obtener datos del shipment
    const tracking_code = shipment.tracking_code;
    const label_url = shipment.postage_label ? shipment.postage_label.label_url : null;
    const carrier = (shipment.selected_rate && shipment.selected_rate.carrier) || rate.carrier;
    const carrier_service = (shipment.selected_rate && shipment.selected_rate.service) || rate.service;
    const shipment_cost = (shipment.selected_rate && shipment.selected_rate.rate) ? Number(shipment.selected_rate.rate) : (rate.rate ? Number(rate.rate) : null);
    const shipment_currency = (shipment.selected_rate && shipment.selected_rate.currency) || rate.currency || null;
    const shipment_id = shipment.id;
    const statusEnvio = shipment.status;

    // 2. Crear la orden SÓLO si no existe y SÓLO después de tener la etiqueta
    if (!orderId && offerHistoryId) {
      try {
        orderResult = await pool.query(
          `INSERT INTO orders (
            offer_history_id, status, tracking_code, label_url, shipped_at, received_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, now(), now()) RETURNING *`,
          [
            offerHistoryId,
            'awaiting_shipment',
            tracking_code,
            label_url,
            null, // shipped_at
            null  // received_at
          ]
        );
        if (orderResult && orderResult.rows && orderResult.rows[0]) {
          orderId = orderResult.rows[0].id;
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

    if (!orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'No se pudo crear ni obtener order_id (falta offer_history_id o error en DB)'
      });
    }

    // 3. Insertar tracking
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
          orderId,
          tracking_code,
          statusEnvio,
          carrier,
          shipment_id,
          carrier_service,
          label_url,
          shipment_cost,
          shipment_currency,
          direction
        ]
      );
    } catch (err) {
      return res.status(500).json({ status: 'error', message: 'Error insertando tracking', error: err.message });
    }

    // 4. Actualizar total_shipping_cost en orders
    try {
      await pool.query(
        `UPDATE orders
         SET total_shipping_cost = (
           SELECT COALESCE(SUM(shipment_cost),0) FROM trackings WHERE order_id = $1
         )
         WHERE id = $1`,
        [orderId]
      );
    } catch (err) {
      console.error('Error al actualizar total_shipping_cost en orders:', err.message);
    }

    // 5. PDF y correo
    let emailResult = null;
    try {
      const destinatario = toAddress.email || req.body.contacto;
      if (!destinatario) throw new Error("No se encontró email de destinatario para enviar la etiqueta.");
      const subject = "Tu etiqueta de envío ICellShop";
      const text = "Adjuntamos tu etiqueta para enviar el paquete a ICellShop. Imprímela y pégala en tu paquete.";
      if (label_url) {
        // Convertir la URL de la etiqueta a PDF (temporal)
        const pdfPath = await imageToPDF(label_url);
        // Leer el buffer del PDF generado
        const pdfBuffer = fs.readFileSync(pdfPath);
        // Eliminar el archivo temporal
        fs.unlinkSync(pdfPath);
        // Enviar correo con el buffer del PDF adjunto
        emailResult = await sendLabelEmail(destinatario, subject, text, null, pdfBuffer);
      }
    } catch (mailError) {
      emailResult = { error: true, details: mailError.message };
    }

    res.json({
      status: 'success',
      label_url,
      tracking_code,
      shipment,
      order: orderResult && orderResult.rows ? orderResult.rows[0] : null,
      email_result: emailResult
    });
  } catch (error) {
    console.error('EasyPost error:', error);

    let msg = error.message;
    if (error.errors) msg = JSON.stringify(error.errors);
    if (error.response && error.response.body) {
      msg = error.response.body.error || JSON.stringify(error.response.body);
    }
    res.status(500).json({
      status: 'error',
      message: 'Error generando etiqueta',
      details: msg,
    });
  }
});

module.exports = router;