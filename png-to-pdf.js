const PDFDocument = require('pdfkit');
const axios = require('axios');
const sizeOf = require('image-size');

/**
 * Descarga un PNG por URL y lo convierte en un PDF (buffer en memoria)
 */
async function pngToPdfBuffer(imageUrl) {
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const imageBuffer = response.data;
  const dimensions = sizeOf(imageBuffer);

  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  doc.addPage({ size: [dimensions.width, dimensions.height] });
  doc.image(imageBuffer, 0, 0);

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = pngToPdfBuffer;
