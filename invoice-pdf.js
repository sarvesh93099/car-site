import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

export const documentNumber = doc => `V31-${doc.type === 'bill' ? 'B' : 'Q'}-${String(doc.id).padStart(4, '0')}`;
const money = value => `INR ${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Generate from the saved record so discounts, taxes and prices match the bill.
export function createDocumentPdf(record) {
 return new Promise((resolve, reject) => {
  const pdf = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true,
   info: { Title: documentNumber(record), Author: 'V31 Concepts' } });
  const chunks = [];
  pdf.on('data', chunk => chunks.push(chunk));
  pdf.on('end', () => resolve(Buffer.concat(chunks)));
  pdf.on('error', reject);
  const left = 42, right = 553, bottom = 780;
  const text = (value, x, y, width, options = {}) => pdf.text(String(value), x, y, { width, ...options });
  const room = height => { if (pdf.y + height > bottom) pdf.addPage(); };
  const logo=process.env.VERCEL?resolvePath(process.cwd(),'assets/images/company_logo.jpeg'):fileURLToPath(new URL('./assets/images/company_logo.jpeg', import.meta.url));
  pdf.image(logo, left, 42, { fit: [100, 60] });
  pdf.font('Helvetica-Bold').fontSize(22);
  text(record.type === 'bill' ? 'BILL' : 'QUOTATION', 285, 42, 268, { align: 'right' });
  pdf.font('Helvetica').fontSize(10);
  text(documentNumber(record), 285, 72, 268, { align: 'right' });
  text(new Date(record.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }), 285, 88, 268, { align: 'right' });
  pdf.font('Helvetica-Bold').fontSize(12);
  text('V31 CONCEPTS / DETAILING STUDIO', left, 118, 511);
  pdf.font('Helvetica').fontSize(10);
  text(`Prepared for: ${record.customer}\nPhone: ${record.phone}${record.vehicle ? `\nVehicle: ${record.vehicle}` : ''}\nStatus: ${record.status}`, left, 146, 511, { lineGap: 5 });
  pdf.moveDown();
  const heading = () => {
   const y = pdf.y;
   pdf.rect(left, y, 511, 26).fill('#eeeeee');
   pdf.fillColor('#111111').font('Helvetica-Bold').fontSize(9);
   text('Product / service', left + 8, y + 8, 210);
   text('Qty', 268, y + 8, 30, { align: 'right' });
   text('Unit price', 310, y + 8, 112, { align: 'right' });
   text('Amount', 434, y + 8, 111, { align: 'right' });
   pdf.y = y + 34;
  };
  heading();
  for (const item of record.items) {
   pdf.font('Helvetica').fontSize(10);
   const height = Math.max(24, pdf.heightOfString(item.name, { width: 210 }) + 14);
   if (pdf.y + height > bottom) { pdf.addPage(); heading(); pdf.font('Helvetica').fontSize(10); }
   const y = pdf.y;
   text(item.name, left + 8, y, 210);
   text(item.quantity, 268, y, 30, { align: 'right' });
   text(money(item.price), 310, y, 112, { align: 'right' });
   text(money(item.price * item.quantity), 434, y, 111, { align: 'right' });
   pdf.moveTo(left, y + height - 5).lineTo(right, y + height - 5).strokeColor('#dddddd').stroke();
   pdf.y = y + height;
  }
  room(150);
  pdf.y += 14;
  for (const [label, value] of [['Subtotal', record.subtotal], ['Discount', record.discount], [`GST (${record.gstRate}%)`, record.gst], [record.type === 'bill' ? 'Total' : 'Estimated total', record.total]]) {
   const y = pdf.y;
   pdf.font(label.includes('total') || label === 'Total' ? 'Helvetica-Bold' : 'Helvetica').fontSize(11);
   text(label, 285, y, 120);
   text(money(value), 407, y, 138, { align: 'right' });
   pdf.y = y + 25;
  }
  pdf.font('Helvetica').fontSize(10);
  if (record.note) {
   room(55); pdf.moveDown();
   text(`Note: ${record.note}`, left, pdf.y, 511, { lineGap: 3 });
  }
  room(45); pdf.moveDown();
  text(record.type === 'bill' ? 'Thank you for choosing V31 Concepts.' : 'Final scope and pricing subject to vehicle assessment.', left, pdf.y, 511);
  const pages = pdf.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
   pdf.switchToPage(i);
   pdf.font('Helvetica').fontSize(8).fillColor('#666666');
   text(`${documentNumber(record)} | Page ${i + 1} of ${pages.count}`, left, 796, 511, { align: 'center', lineBreak: false });
  }
  pdf.end();
 });
}
