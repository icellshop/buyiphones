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

// Endpoint para validar dirección con Google Geocoding API
router.post('/validar-direccion', async (req, res) => {
  let address = req.body.address;

  if (!address) {
    const { street1, street2, city, state, zip } = req.body;
    if (!street1 || !city || !state || !zip) {
      return res.status(400).json({ error: 'Faltan campos de dirección', recibido: req.body });
    }
    address = `${street1}, ${street2 ? street2 + ', ' : ''}${city}, ${state}, ${zip}, US`;
  }

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: apiKey }
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      return res.json({
        status: 'valid',
        datos: response.data.results[0],
        addressSent: address
      });
    } else {
      return res.json({
        status: 'invalid',
        message: 'Dirección no encontrada',
        addressSent: address,
        recibido: req.body
      });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar Google', details: error.message });
  }
});

// Endpoint para generar etiqueta y registrar orden/tracking
router.post('/generar-etiqueta', async (req, res) => {
  try {
    // Preparar direcciones y paquete
    const toAddress = req.body.to_address;
    const fromAddress = req.body.from_address;
    const parcel = req.body.parcel || {
      length: req.body.length,
      width: req.body.width,
      height: req.body.height,
      weight: req.body.weight,
    };

    // Validación mínima para evitar errores tontos
    if (!toAddress || !fromAddress || !parcel) {
      return res.status(400).json({ status: 'error', message: 'Faltan campos obligatorios: to_address, from_address o parcel' });
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

    // Genera PDF y envía por correo
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
        console.error('Error al registrar la orden en DB:', err.message, {
          shipment_cost,
          shipment_currency
        });
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
      console.log(`[EasyPost] Tracking registrado: ${tracking_code} para order_id: ${order_id}`);
    } catch (err) {
      console.error('Error al registrar el tracking en DB:', err.message, {
        order_id, tracking_code, status, carrier, shipment_id, carrier_service, public_url,
        shipment_cost, shipment_currency, direction
      });
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
        console.error('Error al actualizar total_shipping_cost en orders:', err.message);
      }
    }

    res.json({
      status: 'success',
      label_url: shipment.postage_label ? shipment.postage_label.label_url : null,
      tracking_code: tracking_code || null,
      shipment,
      order: orderResult && orderResult.rows ? orderResult.rows[0] : null,
    });
  } catch (error) {
    console.error('ERROR EN /generar-etiqueta:', error);
    let msg = error.message;
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