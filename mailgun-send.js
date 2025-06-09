const mailgun = require("mailgun-js");
const axios = require('axios');
require('dotenv').config();

const DOMAIN = process.env.MAILGUN_DOMAIN;
const mg = mailgun({apiKey: process.env.MAILGUN_API_KEY, domain: DOMAIN});

/**
 * Envía un email con la etiqueta adjunta.
 * @param {string} to - destinatario
 * @param {string} subject - asunto
 * @param {string} text - texto
 * @param {string} labelUrl - url directa de la etiqueta (PNG o PDF)
 */
async function sendLabelEmail(to, subject, text, labelUrl) {
  if (!to || !labelUrl) throw new Error("Falta email destinatario o URL de la etiqueta");

  // Descargar la etiqueta como buffer
  const response = await axios.get(labelUrl, { responseType: 'arraybuffer' });
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
      if (error) return reject(error);
      resolve(body);
    });
  });
}

module.exports = sendLabelEmail;
