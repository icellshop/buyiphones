const formData = require('form-data');
const Mailgun = require('mailgun.js');
const path = require('path');
const fs = require('fs');

const mailgun = new Mailgun(formData);

// Usa variables de entorno para mayor seguridad en producción
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const FROM_EMAIL = process.env.FROM_EMAIL;

const mg = mailgun.client({
  username: 'api',
  key: MAILGUN_API_KEY,
});

module.exports = async function enviarCorreo({ to, pdfPath, trackingCode }) {
  if (!to || !pdfPath || !trackingCode) {
    throw new Error('Faltan parámetros para enviar el correo (to, pdfPath, trackingCode)');
  }

  // Adjuntar PDF solo si existe el archivo
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`No se encontró el archivo PDF para adjuntar: ${pdfPath}`);
  }

  try {
    const result = await mg.messages.create(MAILGUN_DOMAIN, {
      from: FROM_EMAIL,
      to,
      subject: `Tu etiqueta de envío - Tracking: ${trackingCode}`,
      text: `¡Hola!\n\nAdjuntamos tu etiqueta de envío.\nNúmero de guía: ${trackingCode}\n\nGracias por vender tu iPhone con nosotros.\n\nEquipo iCellShop`,
      html: `<p>¡Hola!</p><p>Adjuntamos tu etiqueta de envío.<br><b>Número de guía:</b> ${trackingCode}</p><p>Gracias por vender tu iPhone con nosotros.<br><b>Equipo iCellShop</b></p>`,
      attachment: [{
        data: fs.createReadStream(pdfPath),
        filename: path.basename(pdfPath)
      }]
    });
    console.log('Correo enviado correctamente a', to);
    return result;
  } catch (err) {
    console.error('Error enviando correo con Mailgun:', err);
    throw err;
  }
};