import { jsPDF } from 'jspdf';

/**
 * Generates an array of real PDF File objects with diverse receipt/invoice layouts,
 * including repeat customers across multiple payment dates to showcase the
 * Customer Loyalty & Payment Date Analysis dashboard.
 */
export function generateSamplePdfFiles(includeScannedOcr = false) {
  const files = [];

  if (includeScannedOcr) {
    const scannedDoc = createScannedImagePdf();
    files.push(pdfToFile(scannedDoc, 'Scanned_Starbucks_Receipt_OCR.pdf'));
    return files;
  }

  // 1. Apex Digital Solutions — Payment #1 (Sep 12, 2026)
  const doc1 = new jsPDF();
  doc1.setFont('helvetica', 'bold');
  doc1.setFontSize(18);
  doc1.text('TAX INVOICE', 20, 22);
  doc1.setFontSize(12);
  doc1.text('Customer Name: Apex Digital Solutions LLC', 20, 34);
  doc1.setFont('helvetica', 'normal');
  doc1.setFontSize(10);
  doc1.text('Vendor: Apex Digital Solutions LLC', 20, 41);
  doc1.text('Invoice Number: INV-2026-98104', 20, 52);
  doc1.text('Invoice Date: September 12, 2026', 20, 59);
  doc1.line(20, 67, 190, 67);
  doc1.text('Cloud Hosting & Managed Infrastructure Retainer (Sep)               $1,250.00', 20, 78);
  doc1.text('24/7 Priority SLA Support Add-on                                      $178.50', 20, 86);
  doc1.line(20, 95, 190, 95);
  doc1.setFont('helvetica', 'bold');
  doc1.setFontSize(12);
  doc1.text('Amount Due: $1,428.50', 125, 108);
  files.push(pdfToFile(doc1, 'Apex_Digital_Invoice_Sep2026.pdf'));

  // 2. Apex Digital Solutions — Payment #2 (Oct 12, 2026 - Repeat Customer!)
  const doc2 = new jsPDF();
  doc2.setFont('helvetica', 'bold');
  doc2.setFontSize(18);
  doc2.text('TAX INVOICE', 20, 22);
  doc2.setFontSize(12);
  doc2.text('Customer Name: Apex Digital Solutions LLC', 20, 34);
  doc2.setFont('helvetica', 'normal');
  doc2.setFontSize(10);
  doc2.text('Vendor: Apex Digital Solutions LLC', 20, 41);
  doc2.text('Invoice Number: INV-2026-98412', 20, 52);
  doc2.text('Invoice Date: October 12, 2026', 20, 59);
  doc2.line(20, 67, 190, 67);
  doc2.text('Cloud Hosting & Managed Infrastructure Retainer (Oct)               $1,250.00', 20, 78);
  doc2.text('Database Performance Optimization Package                             $400.00', 20, 86);
  doc2.line(20, 95, 190, 95);
  doc2.setFont('helvetica', 'bold');
  doc2.setFontSize(12);
  doc2.text('Amount Due: $1,650.00', 125, 108);
  files.push(pdfToFile(doc2, 'Apex_Digital_Invoice_Oct2026.pdf'));

  // 3. Nordstrom Creative Studio — Payment #1 (Oct 09, 2026)
  const doc3 = new jsPDF();
  doc3.setFont('helvetica', 'bold');
  doc3.setFontSize(16);
  doc3.text('Nordstrom Creative Studio', 20, 24);
  doc3.setFont('helvetica', 'normal');
  doc3.setFontSize(10);
  doc3.text('760 Market Street, Floor 10, San Francisco, CA 94102', 20, 31);
  doc3.text('Receipt Number: REC-883190', 20, 43);
  doc3.text('Date of Issue: 09 Oct 2026', 20, 50);
  doc3.text('Billed To: Nordstrom Creative Studio', 20, 57);
  doc3.line(20, 65, 190, 65);
  doc3.text('Enterprise Design System Subscription (12 Seats)                      $720.00', 20, 75);
  doc3.setFont('helvetica', 'bold');
  doc3.setFontSize(12);
  doc3.text('Net Total: $720.00', 135, 92);
  files.push(pdfToFile(doc3, 'Nordstrom_Studio_Oct09.pdf'));

  // 4. Nordstrom Creative Studio — Payment #2 (Oct 15, 2026 - Repeat Customer!)
  const doc4 = new jsPDF();
  doc4.setFont('helvetica', 'bold');
  doc4.setFontSize(16);
  doc4.text('Nordstrom Creative Studio', 20, 24);
  doc4.setFont('helvetica', 'normal');
  doc4.setFontSize(10);
  doc4.text('Receipt Number: REC-889401', 20, 38);
  doc4.text('Date of Issue: 15 Oct 2026', 20, 46);
  doc4.text('Billed To: Nordstrom Creative Studio', 20, 54);
  doc4.line(20, 62, 190, 62);
  doc4.text('Brand Identity & UI Prototyping Workshop                              $950.00', 20, 74);
  doc4.setFont('helvetica', 'bold');
  doc4.setFontSize(12);
  doc4.text('Net Total: $950.00', 135, 90);
  files.push(pdfToFile(doc4, 'Nordstrom_Studio_Oct15.pdf'));

  // 5. Whole Foods Market Corporate Catering (Oct 12, 2026 - Same date as Apex #2!)
  const doc5 = new jsPDF();
  doc5.setFont('courier', 'bold');
  doc5.setFontSize(16);
  doc5.text('Whole Foods Market', 20, 25);
  doc5.setFont('courier', 'normal');
  doc5.setFontSize(10);
  doc5.text('Receipt #: WFM-449102', 20, 38);
  doc5.text('Date: 2026-10-12   Time: 14:22', 20, 46);
  doc5.text('------------------------------------------------', 20, 54);
  doc5.text('Executive Team Catering Platter          $240.00', 20, 64);
  doc5.text('Organic Cold Brew & Refreshments          $86.45', 20, 72);
  doc5.setFont('courier', 'bold');
  doc5.setFontSize(12);
  doc5.text('Grand Total:                            $326.45', 20, 86);
  files.push(pdfToFile(doc5, 'Whole_Foods_Receipt_Oct12.pdf'));

  // 6. Horizon Global Logistics (Oct 15, 2026 - One-Time Customer)
  const doc6 = new jsPDF();
  doc6.setFont('helvetica', 'bold');
  doc6.setFontSize(16);
  doc6.text('Horizon Global Logistics', 20, 24);
  doc6.setFont('helvetica', 'normal');
  doc6.setFontSize(10);
  doc6.text('Order Number: HGL-902184', 20, 38);
  doc6.text('Transaction Date: 10/15/2026', 20, 46);
  doc6.text('Customer Name: Horizon Global Logistics', 20, 54);
  doc6.line(20, 62, 190, 62);
  doc6.text('Annual Fleet Tracking & API Integration License                     $2,480.00', 20, 74);
  doc6.setFont('helvetica', 'bold');
  doc6.setFontSize(12);
  doc6.text('Total Paid: $2,480.00', 130, 90);
  files.push(pdfToFile(doc6, 'Horizon_Logistics_Oct15.pdf'));

  return files;
}

function createScannedImagePdf() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 34px Courier New, monospace';
  ctx.fillText('STARBUCKS COFFEE', 60, 80);

  ctx.font = '24px Courier New, monospace';
  ctx.fillText('Store: Starbucks Reserve Roastery', 60, 130);
  ctx.fillText('Receipt No: SBX-77412', 60, 175);
  ctx.fillText('Date: 2026-10-16', 60, 220);
  ctx.fillText('--------------------------------------', 60, 265);
  ctx.fillText('2x Cold Brew Nitro             $11.90', 60, 310);
  ctx.fillText('1x Almond Croissant             $5.45', 60, 355);
  ctx.fillText('1x Espresso Macchiato           $4.25', 60, 400);
  ctx.fillText('--------------------------------------', 60, 445);
  ctx.fillText('Subtotal                       $21.60', 60, 490);
  ctx.font = 'bold 28px Courier New, monospace';
  ctx.fillText('Total Amount: $23.45', 60, 545);

  const imgData = canvas.toDataURL('image/jpeg', 0.95);
  const doc = new jsPDF();
  doc.addImage(imgData, 'JPEG', 15, 15, 170, 128);
  return doc;
}

function pdfToFile(doc, filename) {
  const arrayBuffer = doc.output('arraybuffer');
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  return new File([blob], filename, { type: 'application/pdf' });
}
