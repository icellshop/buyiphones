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

// Endpoint para generar etiqueta con EasyPost, enviar por email, devolver PDF y registrar la orden y el tracking
router.post('/generar-etiqueta', async (req, res) => {
  try {
    // 1. Preparar direcciones y parcel para EasyPost
    const toAddress = {
      name: req.body.to_address.name,
      street1: req.body.to_address.street1,
      street2: req.body.to_address.street2,
      city: req.body.to_address.city,
      state: req.body.to_address.state,
      zip: req.body.to_address.zip,
      country: req.body.to_address.country || 'US',
      phone: req.body.to_address.phone,
      email: req.body.to_address.email,
    };

    const fromAddress = {
      name: req.body.from_address.name,
      street1: req.body.from_address.street1,
      street2: req.body.from_address.street2,
      city: req.body.from_address.city,
      state: req.body.from_address.state,
      zip: req.body.from_address.zip,
      country: req.body.from_address.country || 'US',
      phone: req.body.from_address.phone,
      email: req.body.from_address.email,
    };

    // Usa los datos de parcel, permitiendo fallback a req.body.parcel
    const parcel = req.body.parcel || {
      length: req.body.length,
      width: req.body.width,
      height: req.body.height,
      weight: req.body.weight,
    };

    // 2. Crear el shipment en EasyPost
    let shipment = await api.Shipment.create({
      to_address: toAddress,
      from_address: fromAddress,
      parcel: parcel,
    });

    // 3. Comprar la etiqueta (el mejor rate disponible)
    let rate;
    if (shipment && shipment.rates && shipment.rates[0]) {
      rate = shipment.rates[0];
    } else {
      throw new Error('No se encontraron rates para el envío');
    }
    shipment = await api.Shipment.buy(shipment.id, rate);

    // 4. Extraer datos para DB, asegurando que existan los valores correctos
    // Usa shipment.selected_rate como preferido, sino usa el rate usado para comprar
    const selectedRate = shipment.selected_rate || rate;
    const shipment_cost = selectedRate ? Number(selectedRate.rate) : null;
    const shipment_currency = selectedRate ? selectedRate.currency : null;
    const tracking_code = shipment.tracking_code;
    const shipment_id = shipment.id;
    const status = shipment.status;
    const carrier = selectedRate.carrier;
    const carrier_service = selectedRate.service;
    const public_url = shipment.public_url || null;
    const direction = req.body.direction || "to_icellshop"; // "return_to_sender" para devoluciones

    // DEBUG: Verifica valores antes del insert
    console.log('Antes del insert:', {
      shipment_cost,
      shipment_currency,
      offerHistoryId: req.body.offer_history_id,
      tracking_code,
      labelUrl: shipment.postage_label.label_url
    });
    console.log('shipment.selected_rate:', shipment.selected_rate);
    console.log('rate usado para comprar:', rate);

    // 5. Email del destinatario y URL de la etiqueta (PNG normalmente)
    const destinatario = toAddress.email;
    const labelUrl = shipment.postage_label.label_url;
    const subject = 'Tu etiqueta de envío de ICellShop';
    const text = 'Adjuntamos la etiqueta de tu envío. Imprímela y colócala en el paquete.';

    // 6. Genera PDF temporal desde la imagen (PNG)
    const pdfPath = await imageToPDF(labelUrl);

    // 7. Copia a una carpeta pública para servirlo (por ejemplo, public/tmp/)
    const publicPath = path.join(__dirname, '..', 'public', 'tmp');
    if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath, { recursive: true });
    const pdfFileName = `etiqueta_${Date.now()}.pdf`;
    const finalPdfPath = path.join(publicPath, pdfFileName);
    fs.copyFileSync(pdfPath, finalPdfPath);

    // 8. Borra el archivo temporal creado por imageToPDF
    fs.unlinkSync(pdfPath);

    // 9. Crea la URL pública (asumiendo que sirves /public como estático y /tmp es accesible)
    const labelPdfUrl = `/tmp/${pdfFileName}`;

    // 10. Envía el correo con el PDF adjunto (finalPdfPath)
    try {
      await sendLabelEmail(destinatario, subject, text, finalPdfPath);
    } catch (err) {
      console.error('Error enviando correo:', err);
    }

    // 11. Registro en la base de datos (orders), usando offer_history_id si viene
    const offerHistoryId = req.body.offer_history_id || null;
    let orderResult = null;
    let order_id = null;
    if (offerHistoryId) {
      try {
        orderResult = await pool.query(
          `INSERT INTO orders (
            offer_history_id,
            status,
            tracking_code,
            label_url,
            shipped_at,
            shipment_cost,
            shipment_currency
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            offerHistoryId,              // $1
            'awaiting_shipment',         // $2
            tracking_code,               // $3
            shipment.postage_label.label_url, // $4
            null,                        // $5 (shipped_at)
            shipment_cost,               // $6
            shipment_currency            // $7
          ]
        );
        if (orderResult && orderResult.rows && orderResult.rows[0]) {
          order_id = orderResult.rows[0].id;
        }
      } catch (err) {
        // Mostramos el error en consola y se lo mandamos al frontend
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

    // 12. Registro en la tabla trackings, AHORA CON shipment_cost y shipment_currency
    try {
      await pool.query(
        `INSERT INTO trackings (
          order_id, tracking_code, status, carrier, shipment_id,
          carrier_service, public_url, shipment_cost, shipment_currency, direction, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
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

    // 13. Actualiza el total_shipping_cost en orders
    if (order_id) {
      try {
        await pool.query(
          `UPDATE orders
           SET total_shipping_cost = (
             SELECT COALESCE(SUM(shipment_cost),0) FROM trackings WHERE order_id = $1
           )
           WHERE id = $1
          `,
          [order_id]
        );
      } catch (err) {
        console.error('Error al actualizar total_shipping_cost en orders:', err.message);
      }
    }

    // 14. Devolver respuesta
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