const express = require('express');
const router = express.Router();

const EASYPOST_API_KEY = 'EZTKb51ba39e3b134e899967871cb40b7178e1Gimxm0dU6qEb9KXkHFDA'; // <-- pon tu API key real aquí

// Si usas Node < 18, descomenta la siguiente línea:
// const fetch = require('node-fetch');

router.post('/', async (req, res) => {
  const { street1, street2, city, state, zip } = req.body;
  const country = "US";
  try {
    const body = {
      address: { street1, street2, city, state, zip, country },
      verify: ['delivery']
    };

    // Log para ver exactamente qué se envía a EasyPost
    console.log("Enviando a EasyPost:", JSON.stringify(body, null, 2));

    const epRes = await fetch('https://api.easypost.com/v2/addresses', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(EASYPOST_API_KEY + ':').toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await epRes.json();

    if (data.verifications && data.verifications.delivery && data.verifications.delivery.success) {
      res.json({ status: 'valid', address: data });
    } else if (
      data.verifications &&
      data.verifications.delivery &&
      data.verifications.delivery.suggestions &&
      data.verifications.delivery.suggestions.length
    ) {
      res.json({
        status: 'suggestion',
        suggestion: data.verifications.delivery.suggestions[0],
        message: 'Dirección no válida, pero se sugiere una corrección.'
      });
    } else {
      let message = 'No se pudo verificar la dirección. ';
      if (data.verifications && data.verifications.delivery && data.verifications.delivery.errors) {
        message += data.verifications.delivery.errors.map(e => e.message).join(', ');
      }
      res.json({ status: 'invalid', message });
    }
  } catch (err) {
    res.json({ status: 'error', message: 'Error validando dirección.' });
  }
});

module.exports = router;
