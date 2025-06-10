const mailgun = require("mailgun-js");
const pngToPdfBuffer = require('./png-to-pdf'); // Asegúrate del path correcto

const DOMAIN = process.env.MAILGUN_DOMAIN;
const API_KEY = process.env.MAILGUN_API_KEY;
const mg = mailgun({ apiKey: API_KEY, domain: DOMAIN });

/**
 * Envía un email con la etiqueta adjunta (convertida a PDF si es PNG)
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} labelUrl - URL de la etiqueta (PNG o PDF)
 */
async function sendLabelEmail(to, subject, text, labelUrl) {
  if (!to || !labelUrl) throw new Error("Falta email destinatario o URL de la etiqueta");

  let attachment;
  if (labelUrl.endsWith('.png')) {
    // Convierte PNG a PDF
    const pdfBuffer = await pngToPdfBuffer(labelUrl);
    attachment = new mg.Attachment({
      data: pdfBuffer,
      filename: 'etiqueta.pdf',
      contentType: 'application/pdf'
    });
  } else {
    // Si ya es PDF, simplemente adjunta el archivo remoto
    const axios = require('axios');
    const response = await axios.get(labelUrl, { responseType: 'arraybuffer' });
    attachment = new mg.Attachment({
      data: response.data,
      filename: 'etiqueta.pdf',
      contentType: 'application/pdf'
    });
  }

  const data = {
    from: 'iCellShop <contacto@icellshop.mx>',
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
