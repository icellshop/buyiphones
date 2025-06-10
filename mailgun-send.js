const mailgun = require('mailgun-js');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Descarga imagen desde una URL y la convierte a PDF temporal.
 */
async function imageToPDF(labelUrl) {
  const response = await axios.get(labelUrl, { responseType: 'arraybuffer' });
  const imgBuffer = Buffer.from(response.data);
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

async function downloadPDF(labelUrl) {
  const response = await axios.get(labelUrl, { responseType: 'arraybuffer' });
  const tempPDFPath = path.join(os.tmpdir(), `etiqueta_${Date.now()}.pdf`);
  fs.writeFileSync(tempPDFPath, response.data);
  return tempPDFPath;
}

/**
 * Envía un correo con la etiqueta como PDF adjunto usando Mailgun.
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
    try {
      attachmentPath = await imageToPDF(labelUrl);
    } catch (e) {
      attachmentPath = await downloadPDF(labelUrl);
    }
  }

  const stats = fs.statSync(attachmentPath);
  console.log('PDF generado:', attachmentPath, 'Tamaño:', stats.size);

  // Crea el Attachment correctamente
  const attachment = new mg.Attachment({
    data: fs.readFileSync(attachmentPath), // Usa el buffer directamente
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
    attachment // No es array, es Attachment directo
  };

  // LOG para depuración
  console.log('Enviando mail a:', to, 'con adjunto:', attachment.filename);

  return new Promise((resolve, reject) => {
    mg.messages().send(data, function (error, body) {
      fs.unlink(attachmentPath, () => {});
      if (error) {
        console.error('Mailgun error:', error);
        return reject(error);
      }
      console.log('Mailgun OK:', body);
      resolve(body);
    });
  });
}

module.exports = sendLabelEmail;
