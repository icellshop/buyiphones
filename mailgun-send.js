const mailgun = require('mailgun-js');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Descarga una imagen desde una URL y la convierte a un PDF temporal.
 * Devuelve la ruta al archivo PDF generado.
 */
async function imageToPDF(labelUrl) {
  // Descarga la imagen como buffer
  const response = await axios.get(labelUrl, { responseType: 'arraybuffer' });
  const imgBuffer = Buffer.from(response.data);

  // Crea un archivo temporal para el PDF
  const tempPDFPath = path.join(os.tmpdir(), `etiqueta_${Date.now()}.pdf`);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const writeStream = fs.createWriteStream(tempPDFPath);

    writeStream.on('finish', () => resolve(tempPDFPath));
    writeStream.on('error', reject);

    doc.pipe(writeStream);

    let imgDims;
    try {
      imgDims = doc.openImage(imgBuffer);
    } catch (e) {
      return reject(new Error('No se pudo procesar la imagen descargada'));
    }

    doc.addPage({ size: [imgDims.width, imgDims.height] });
    doc.image(imgBuffer, 0, 0);

    doc.end();
  });
}

/**
 * Descarga el PDF de una URL y lo guarda como archivo temporal.
 * Devuelve la ruta al archivo PDF generado.
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

  let attachmentPath;
  if (labelUrl.endsWith('.pdf')) {
    attachmentPath = await downloadPDF(labelUrl);
  } else if (
    labelUrl.endsWith('.png') ||
    labelUrl.endsWith('.jpg') ||
    labelUrl.endsWith('.jpeg')
  ) {
    attachmentPath = await imageToPDF(labelUrl);
  } else {
    // Si no se reconoce la extensión, intenta como imagen, si falla como PDF
    try {
      attachmentPath = await imageToPDF(labelUrl);
    } catch (e) {
      attachmentPath = await downloadPDF(labelUrl);
    }
  }

  // Para depuración: verifica el archivo generado
  const stats = fs.statSync(attachmentPath);
  console.log('PDF generado:', attachmentPath, 'Tamaño:', stats.size);

  const attachment = new mg.Attachment({
    data: fs.createReadStream(attachmentPath),
    filename: 'etiqueta.pdf',
    contentType: 'application/pdf'
  });

  const html = `
    <p>${text}</p>
    <p>Adjuntamos tu etiqueta en PDF.<br>
    Si tienes problemas, también puedes verla aquí:<br>
    <a href="${labelUrl}" target="_blank">${labelUrl}</a></p>
  `;

  const data = {
    from: `ICellShop <no-reply@${DOMAIN}>`,
    to,
    subject,
    text: `${text}\n\nEtiqueta: ${labelUrl}`,
    html,
    attachment // sin corchetes, solo uno
  };

  return new Promise((resolve, reject) => {
    mg.messages().send(data, function (error, body) {
      fs.unlink(attachmentPath, () => {});
      if (error) return reject(error);
      resolve(body);
    });
  });
}

module.exports = sendLabelEmail;
