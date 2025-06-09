const fs = require('fs');
const path = require('path');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const EasyPost = require('@easypost/api');
const enviarCorreo = require('./mailgun-send');

// --- CONFIGURACIÓN DE KEYS ---
const EASYPOST_API_KEY = process.env.EASYPOST_API_KEY || 'EZTKb51ba39e3b134e899967871cb40b7178e1Gimxm0dU6qEb9KXkHFDA';
const easypost = new EasyPost(EASYPOST_API_KEY);

const TMP_DIR = path.resolve(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// --- Función auxiliar: descarga PNG desde EasyPost ---
async function descargarPNG(url, filename) {
  const response = await axios.get(url, { responseType: 'stream' });
  const pngPath = path.resolve(TMP_DIR, filename);
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(pngPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  return pngPath;
}

// --- Genera un código de descuento aleatorio ---
function generarCodigoDescuento() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += letras.charAt(Math.floor(Math.random() * letras.length));
  }
  return 'ICELL-' + codigo;
}

// --- Crea la hoja legal en la página actual de PDFKit ---
function crearHojaLegal(doc, cliente, equipo, codigoDescuento) {
  doc.fontSize(18).text('Declaración de venta de equipo', { align: 'center', underline: true });
  doc.moveDown();
  doc.fontSize(12)
    .text(
      `Yo, ${cliente.nombre}, declaro que el equipo que entrego para venta NO es robado, financiado, ni obtenido de manera fraudulenta. Estoy consciente de que vender dispositivos obtenidos ilícitamente es un delito federal y acepto toda responsabilidad legal sobre el origen del equipo.`
    );
  doc.moveDown();
  doc.text('Firma: ___________________________    Fecha: _______________', { align: 'left' });
  doc.moveDown(2);
  doc.fontSize(14).text('Datos del vendedor:', { underline: true });
  doc.fontSize(12)
    .text(`- Nombre: ${cliente.nombre}`)
    .text(`- Dirección: ${cliente.direccion}`)
    .text(`- Correo: ${cliente.correo}`)
  doc.moveDown();
  doc.fontSize(14).text('Datos del equipo:', { underline: true });
  doc.fontSize(12)
    .text(`- Marca/Modelo: ${equipo.modelo}`)
    .text(`- IMEI/Serie: ${equipo.imei}`);
  doc.moveDown(2);
  doc.fontSize(12).text('¡Gracias por tu confianza!', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Usa el siguiente código para obtener $10 USD de descuento en tu próxima venta:`, { align: 'center' });
  doc.fontSize(18).text(codigoDescuento, { align: 'center', underline: true });
}

// --- Convierte PNG a PDF y agrega la hoja legal antes ---
async function crearPDFConHojaLegal(hojaLegalInfo, pngPath, pdfPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER' });
    const stream = fs.createWriteStream(pdfPath);

    // --- Página 1: hoja legal ---
    crearHojaLegal(doc, hojaLegalInfo.cliente, hojaLegalInfo.equipo, hojaLegalInfo.codigoDescuento);

    // --- Página 2: la guía ---
    doc.addPage({ size: 'LETTER' });
    doc.image(pngPath, 0, 0, { fit: [612, 792] }); // Tamaño carta

    doc.pipe(stream);
    doc.end();
    stream.on('finish', () => resolve(pdfPath));
    stream.on('error', reject);
  });
}

// --- FUNCIÓN PRINCIPAL: genera la etiqueta ---
async function generarEtiqueta(body) {
  // LOG SEGURO: solo mostramos el body recibido
  console.log('BODY RECIBIDO EN generarEtiqueta:', body);

  // --- VALIDACION DE DATOS ---
  const { to_address, payment_method, payment_value, contacto, equipo } = body || {};
  if (!to_address || typeof to_address !== "object") {
    throw new Error('Falta el objeto to_address.');
  }
  const requeridos = ['name', 'street1', 'city', 'state', 'zip'];
  for (const campo of requeridos) {
    if (!to_address[campo]) {
      throw new Error(`Falta el campo '${campo}' en to_address.`);
    }
  }
  if (!contacto) {
    throw new Error('Falta el correo electrónico o contacto.');
  }
  // Datos del equipo (puedes validar más si gustas)
  const datosEquipo = equipo || { modelo: '', imei: '' };

  try {
    // 1. Crear dirección destino en EasyPost
    const toAddress = await easypost.Address.create({
      name: to_address.name,
      street1: to_address.street1,
      street2: to_address.street2 || undefined,
      city: to_address.city,
      state: to_address.state,
      zip: to_address.zip,
      country: to_address.country || "MX",
      phone: to_address.phone || contacto,
      email: contacto
    });

    // 2. Dirección desde (reemplaza estos datos por los tuyos reales)
    const fromAddress = await easypost.Address.create({
      company: "iCellShop",
      street1: "123 Main St",
      city: "Miami",
      state: "FL",
      zip: "33101",
      country: "US",
      phone: "3055551234",
      email: "contacto@icellshop.mx"
    });

    // 3. Crear el paquete (parcela)
    const parcel = await easypost.Parcel.create({
      length: 7,
      width: 4,
      height: 2,
      weight: 16 // en onzas
    });

    // 4. Crear el envío
    const shipment = await easypost.Shipment.create({
      to_address: toAddress,
      from_address: fromAddress,
      parcel,
      options: { label_format: "PNG" }
    });

    // 5. Obtener la mejor tarifa disponible (por ejemplo, USPS)
    const lowestRate = shipment.lowestRate(["USPS"]);

    // 6. Comprar el envío con el método estático (SDK EasyPost v5+)
    // Esto regresa el shipment actualizado (con etiqueta, tracking, etc.)
    const boughtShipment = await easypost.Shipment.buy(shipment.id, lowestRate);

    // 7. Descargar el PNG desde el label_url
    const labelUrl = boughtShipment.postage_label.label_url;
    const trackingCode = boughtShipment.tracking_code;
    const pngFileName = `etiqueta_${trackingCode}.png`;
    const pdfFileName = `etiqueta_${trackingCode}.pdf`;

    const pngPath = await descargarPNG(labelUrl, pngFileName);

    // 8. Generar código de descuento
    const codigoDescuento = generarCodigoDescuento();

    // 9. Preparar datos para la hoja legal
    const hojaLegalInfo = {
      cliente: {
        nombre: to_address.name,
        direccion: `${to_address.street1} ${to_address.street2 || ''}, ${to_address.city}, ${to_address.state}, ${to_address.zip}, ${to_address.country || ''}`,
        correo: contacto
      },
      equipo: datosEquipo,
      codigoDescuento
    };

    // 10. Crear PDF completo con hoja legal y guía
    const pdfPath = path.resolve(TMP_DIR, pdfFileName);
    await crearPDFConHojaLegal(hojaLegalInfo, pngPath, pdfPath);

    // 11. Enviar el PDF por correo
    await enviarCorreo({
      to: contacto,
      pdfPath,
      trackingCode
    });

    // 12. Limpieza (opcional)
    try { fs.unlinkSync(pngPath); } catch {}
    try { fs.unlinkSync(pdfPath); } catch {}

    // 13. Retornar info útil
    return {
      status: 'success',
      label_url: labelUrl,
      tracking_code: trackingCode,
      codigo_descuento: codigoDescuento
    };

  } catch (err) {
    console.error('ERROR generando etiqueta:', err);
    return {
      status: 'error',
      message: err.message || 'Error desconocido'
    };
  }
}

module.exports = generarEtiqueta;