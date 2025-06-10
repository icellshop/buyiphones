const mailgun = require('mailgun-js');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Descarga una imagen desde una URL y la convierte a un PDF temporal.
 * Retorna la ruta absoluta del PDF generado.
 */
async function imageToPDF(labelUrl) {
  // Descarga la imagen como buffer
  const response = await axios.get(labelUrl, { responseType: 'arraybuffer' });

  // Crea un archivo temporal para el PDF
  const tempPDFPath = path.join(os.tmpdir(), `etiqueta_${Date.now()}.pdf`);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const writeStream = fs.createWriteStream(tempPDFPath);

    writeStream.on('finish', () => resolve(tempPDFPath));
    writeStream.on('error', reject);

    doc.pipe(writeStream);

    // La imagen original puede tener cualquier tamaño, así que agregamos una página con tamaño adecuado
    let img;
    try {
      img = doc.openImage(response.data);
    } catch (e) {
      return reject(new Error('No se pudo procesar la imagen descargada'));
    }

    doc.addPage({ size: [img.width, img.height] });
    doc.image(response.data, 0, 0);

    doc.end();
  });
}

/**
 * Descarga el PDF de una URL y lo guarda como archivo temporal.
 * Retorna la ruta absoluta del PDF generado.
 */
async function downloadPDF(labelUrl) {
  const response = await axios.get(labelUrl, { responseType: 'arraybuffer' });
  const tempPDFPath = path.join(os.tmpdir(), `etiqueta_${Date.now()}.pdf`);
  fs.writeFileSync(tempPDFPath, response.data);
  return tempPDFPath;
}

/**
 * Envía un correo con la etiqueta como PDF adjunto usando Mailgun.
 * Si la etiqueta es PNG/JPG, la convierte a PDF antes de adjuntarla.
 */
async function sendLabelEmail(to, subject, text, labelUrl) {
  const DOMAIN = process.env.MAILGUN_DOMAIN;
  const mg = mailgun({ apiKey: process.env.MAILGUN_API_KEY, domain: DOMAIN });

  // Determina si es PDF o imagen
  let attachmentPath;
  if (labelUrl.endsWith('.pdf')) {
    attachmentPath = await downloadPDF(labelUrl);
  } else if (labelUrl.endsWith('.png') || labelUrl.endsWith('.jpg') || labelUrl.endsWith('.jpeg')) {
    attachmentPath = await imageToPDF(labelUrl);
  } else {
    // Si no se reconoce la extensión, intenta descargar y convertir como imagen
    try {
      attachmentPath = await imageToPDF(labelUrl);
    } catch (e) {
      // Si falla, intenta descargar como PDF
      attachmentPath = await downloadPDF(labelUrl);
    }
  }

  const html = `
    <p>${text}</p>
    <p>Adjuntamos tu etiqueta en PDF. Si tienes problemas, también puedes verla aquí:<br>
    <a href="${labelUrl}" target="_blank">${labelUrl}</a></p>
  `;

  const data = {
    from: `ICellShop <no-reply@${DOMAIN}>`,
    to,
    subject,
    text: `${text}\n\nEtiqueta: ${labelUrl}`,
    html,
    attachment: [
      new mg.Attachment({
        data: fs.createReadStream(attachmentPath),
        filename: 'etiqueta.pdf',
        contentType: 'application/pdf'
      })
    ]
  };

  return new Promise((resolve, reject) => {
    mg.messages().send(data, function (error, body) {
      // Borra el archivo temporal después de enviar el mail
      fs.unlink(attachmentPath, () => {});
      if (error) return reject(error);
      resolve(body);
    });
  });
}

module.exports = sendLabelEmail;
