const mailgun = require("mailgun-js");
const axios = require('axios');
require('dotenv').config();

const DOMAIN = process.env.MAILGUN_DOMAIN;
const API_KEY = process.env.MAILGUN_API_KEY;

if (!DOMAIN) console.error('[Mailgun] MAILGUN_DOMAIN no está definido');
if (!API_KEY) console.error('[Mailgun] MAILGUN_API_KEY no está definido');

const mg = mailgun({apiKey: API_KEY, domain: DOMAIN});

/**
 * Envía un email con la etiqueta adjunta.
 * @param {string} to - destinatario
 * @param {string} subject - asunto
 * @param {string} text - texto
 * @param {string} labelUrl - url directa de la etiqueta (PNG o PDF)
 */
async function sendLabelEmail(to, subject, text, labelUrl) {
  console.log('[Mailgun] Preparando para enviar a:', to, 'LabelURL:', labelUrl);

  if (!to || !labelUrl) {
    const msg = "Falta email destinatario o URL de la etiqueta";
    console.error('[Mailgun] ' + msg);
    throw new Error(msg);
  }

  // Descargar la etiqueta como buffer
  let response;
  try {
    response = await axios.get(labelUrl, { responseType: 'arraybuffer' });
  } catch (err) {
    console.error('[Mailgun] Error descargando la etiqueta:', err.message);
    throw err;
  }

  const filename = labelUrl.endsWith('.pdf') ? 'etiqueta.pdf' : 'etiqueta.png';

  const attachment = new mg.Attachment({
    data: response.data,
    filename,
    contentType: response.headers['content-type']
  });

  const data = {
    from: `ICellShop <no-reply@${DOMAIN}>`,
    to,
    subject,
    text,
    attachment
  };

  return new Promise((resolve, reject) => {
    mg.messages().send(data, function (error, body) {
      if (error) {
        console.error('[Mailgun] ERROR al enviar:', error);
        return reject(error);
      }
      console.log('[Mailgun] Enviado correctamente:', body);
      resolve(body);
    });
  });
}

module.exports = sendLabelEmail;
