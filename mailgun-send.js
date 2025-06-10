const mailgun = require("mailgun-js");

/**
 * Envía un correo con un enlace a la etiqueta (labelUrl) usando Mailgun.
 * @param {string} to - Email del destinatario.
 * @param {string} subject - Asunto del correo.
 * @param {string} text - Texto del correo.
 * @param {string} labelUrl - URL del PDF de la etiqueta a adjuntar como enlace.
 * @returns {Promise} Resultados de mailgun o lanza error.
 */
async function sendLabelEmail(to, subject, text, labelUrl) {
  const DOMAIN = process.env.MAILGUN_DOMAIN;
  const mg = mailgun({ apiKey: process.env.MAILGUN_API_KEY, domain: DOMAIN });

  // Puedes personalizar el HTML para mostrar el enlace o incrustar la imagen/PDF
  const html = `
    <p>${text}</p>
    <p><a href="${labelUrl}" target="_blank">Descargar etiqueta (PDF)</a></p>
    <p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
    <p>${labelUrl}</p>
  `;

  const data = {
    from: `ICellShop <no-reply@${DOMAIN}>`,
    to,
    subject,
    text: `${text}\n\nEtiqueta: ${labelUrl}`,
    html,
  };

  return new Promise((resolve, reject) => {
    mg.messages().send(data, function (error, body) {
      if (error) return reject(error);
      resolve(body);
    });
  });
}

module.exports = sendLabelEmail;
