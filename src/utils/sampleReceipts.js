import { jsPDF } from 'jspdf';

/**
 * Generates an array of real PDF File objects with diverse receipt/invoice layouts
 * (including native text PDFs and a scanned image-based PDF for OCR testing).
 */
export function generateSamplePdfFiles(includeScannedOcr = false) {
  const files = [];

  // 1. AWS Cloud B2B Invoice (MMM DD, YYYY format + "Amount Due")
  const doc1 = new jsPDF();
  doc1.setFont('helvetica', 'bold');
  doc1.setFontSize(18);
  doc1.text('TAX INVOICE', 20, 22);
  doc1.setFontSize(12);
  doc1.text('Vendor: Amazon Web Services, Inc.', 20, 34);
  doc1.setFont('helvetica', 'normal');
  doc1.setFontSize(10);
  doc1.text('410 Terry Ave North, Seattle, WA 98109', 20, 41);
  doc1.text('Invoice Number: INV-2026-98412', 20, 52);
  doc1.text('Invoice Date: October 12, 2026', 20, 59);
  doc1.text('Billed To: Apex Digital Solutions LLC', 20, 70);
  doc1.line(20, 77, 190, 77);
  doc1.text('Description                                                           Amount', 20, 85);
  doc1.line(20, 89, 190, 89);
  doc1.text('Amazon EC2 Compute Instances (us-east-1)                             $980.00', 20, 98);
  doc1.text('Amazon RDS PostgreSQL Production Cluster                             $340.50', 20, 106);
  doc1.text('AWS CloudFront Data Transfer & S3 Storage                            $108.00', 20, 114);
  doc1.line(20, 122, 190, 122);
  doc1.text('Subtotal: $1,428.50', 135, 132);
  doc1.text('Tax (0%): $0.00', 135, 139);
  doc1.setFont('helvetica', 'bold');
  doc1.setFontSize(12);
  doc1.text('Amount Due: $1,428.50', 125, 150);
  files.push(pdfToFile(doc1, 'AWS_Cloud_Invoice_Oct2026.pdf'));

  // 2. Whole Foods Market Retail Receipt (YYYY-MM-DD format + "Grand Total")
  const doc2 = new jsPDF();
  doc2.setFont('courier', 'bold');
  doc2.setFontSize(16);
  doc2.text('WHOLE FOODS MARKET', 20, 25);
  doc2.setFont('courier', 'normal');
  doc2.setFontSize(10);
  doc2.text('270 Greenwich St, New York, NY 10007', 20, 33);
  doc2.text('Receipt #: WFM-449102', 20, 43);
  doc2.text('Date: 2026-10-14   Time: 14:22', 20, 50);
  doc2.text('------------------------------------------------', 20, 58);
  doc2.text('Organic Honeycrisp Apples                $12.99', 20, 66);
  doc2.text('Wild Alaskan Salmon Fillet               $28.50', 20, 73);
  doc2.text('Artisan Sourdough Bread                   $7.49', 20, 80);
  doc2.text('Cold Pressed Olive Oil 750ml             $24.99', 20, 87);
  doc2.text('Organic Almond Milk (2x)                  $8.98', 20, 94);
  doc2.text('------------------------------------------------', 20, 102);
  doc2.text('Subtotal                                 $82.95', 20, 110);
  doc2.text('Sales Tax                                 $3.50', 20, 117);
  doc2.setFont('courier', 'bold');
  doc2.setFontSize(12);
  doc2.text('Grand Total:                             $86.45', 20, 128);
  files.push(pdfToFile(doc2, 'Whole_Foods_Receipt.pdf'));

  // 3. Figma Enterprise SaaS Invoice (DD MMM YYYY format + "Net Total")
  const doc3 = new jsPDF();
  doc3.setFont('helvetica', 'bold');
  doc3.setFontSize(16);
  doc3.text('Figma, Inc.', 20, 24);
  doc3.setFont('helvetica', 'normal');
  doc3.setFontSize(10);
  doc3.text('760 Market Street, Floor 10, San Francisco, CA 94102', 20, 31);
  doc3.text('Receipt Number: REC-883190', 20, 43);
  doc3.text('Date of Issue: 09 Oct 2026', 20, 50);
  doc3.text('Billed To: Nordstrom Creative Studio', 20, 57);
  doc3.line(20, 65, 190, 65);
  doc3.text('Figma Organization Plan - 12 Full Design Seats                       $540.00', 20, 75);
  doc3.text('FigJam Enterprise Collaboration Add-on                               $120.00', 20, 83);
  doc3.text('Subtotal: $660.00', 140, 96);
  doc3.text('Sales Tax (9.09%): $60.00', 140, 103);
  doc3.setFont('helvetica', 'bold');
  doc3.setFontSize(12);
  doc3.text('Net Total: $720.00', 135, 114);
  files.push(pdfToFile(doc3, 'Figma_Enterprise_Invoice.pdf'));

  // 4. Apple Store Receipt (MM/DD/YYYY format + "Total Paid")
  const doc4 = new jsPDF();
  doc4.setFont('helvetica', 'bold');
  doc4.setFontSize(16);
  doc4.text('Apple Store Fifth Avenue', 20, 24);
  doc4.setFont('helvetica', 'normal');
  doc4.setFontSize(10);
  doc4.text('767 5th Ave, New York, NY 10153', 20, 31);
  doc4.text('Order Number: APL-902184', 20, 42);
  doc4.text('Transaction Date: 10/15/2026', 20, 49);
  doc4.text('Customer Name: Fuad Hiybo', 20, 56);
  doc4.line(20, 63, 190, 63);
  doc4.text('MacBook Pro 14-inch (M3 Pro, 18GB, 512GB SSD)                      $1,999.00', 20, 73);
  doc4.text('AppleCare+ for 14-inch MacBook Pro                                   $279.00', 20, 81);
  doc4.text('Subtotal: $2,278.00', 135, 95);
  doc4.text('Estimated Tax: $202.17', 135, 102);
  doc4.setFont('helvetica', 'bold');
  doc4.setFontSize(12);
  doc4.text('Total Paid: $2,480.17', 130, 113);
  files.push(pdfToFile(doc4, 'Apple_Store_Receipt.pdf'));

  // 5. Optional Scanned Image-Only PDF (to demonstrate OCR Fallback)
  if (includeScannedOcr) {
    const scannedDoc = createScannedImagePdf();
    files.push(pdfToFile(scannedDoc, 'Scanned_Starbucks_Receipt_OCR.pdf'));
  }

  return files;
}

function createScannedImagePdf() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');

  // High-contrast paper background
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
