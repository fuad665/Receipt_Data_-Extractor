import * as XLSX from 'xlsx';
import { checkBackendHealth } from './pdfExtractor';

/**
 * Exports records to an Excel (.xlsx) file via FastAPI (pandas/openpyxl)
 * or falls back to SheetJS (xlsx) in the browser.
 */
export async function exportToExcel(records, customFilename = 'receipt_data_export.xlsx') {
  if (!records || records.length === 0) return;

  const isBackendUp = await checkBackendHealth();
  if (isBackendUp) {
    try {
      const response = await fetch('/api/export/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      });

      if (response.ok) {
        const blob = await response.blob();
        triggerDownload(blob, customFilename);
        return;
      }
    } catch (err) {
      console.warn('FastAPI Excel export fallback to SheetJS:', err);
    }
  }

  // Client-side SheetJS (.xlsx) generation
  const rows = records.map((rec, index) => ({
    '#': index + 1,
    'File Name': rec.filename || '',
    'Customer / Merchant Name': rec.merchant_name || '',
    'Customer (Billed To)': rec.customer_name || '',
    'Invoice / Receipt #': rec.invoice_number || '',
    'Date': rec.date || '',
    'Currency': rec.currency || 'USD',
    'Total Amount': rec.total_amount !== null && rec.total_amount !== '' ? Number(rec.total_amount) : 0,
    'Extraction Method': rec.extraction_method || 'Native PDF',
    'Status': (rec.status || 'success').toUpperCase(),
  }));

  const totalSum = rows.reduce((acc, r) => acc + (Number(r['Total Amount']) || 0), 0);
  rows.push({
    '#': '',
    'File Name': `TOTAL (${records.length} Receipts)`,
    'Customer / Merchant Name': '',
    'Customer (Billed To)': '',
    'Invoice / Receipt #': '',
    'Date': '',
    'Currency': '',
    'Total Amount': Math.round(totalSum * 100) / 100,
    'Extraction Method': '',
    'Status': '',
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 30 },
    { wch: 24 },
    { wch: 18 },
    { wch: 14 },
    { wch: 10 },
    { wch: 16 },
    { wch: 22 },
    { wch: 12 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Extracted Receipts');
  XLSX.writeFile(workbook, customFilename);
}

/**
 * Exports records to a formatted JSON (.json) file.
 */
export async function exportToJson(records, customFilename = 'receipt_data_export.json') {
  if (!records || records.length === 0) return;

  const isBackendUp = await checkBackendHealth();
  if (isBackendUp) {
    try {
      const response = await fetch('/api/export/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      });

      if (response.ok) {
        const blob = await response.blob();
        triggerDownload(blob, customFilename);
        return;
      }
    } catch (err) {
      console.warn('FastAPI JSON export fallback to browser:', err);
    }
  }

  const aggregateAmount = records.reduce(
    (sum, r) => sum + (r.total_amount !== null && r.total_amount !== '' ? Number(r.total_amount) || 0 : 0),
    0
  );

  const payload = {
    exported_at: new Date().toISOString(),
    summary: {
      total_receipts: records.length,
      aggregate_amount: Math.round(aggregateAmount * 100) / 100,
    },
    records: records.map((r) => ({
      id: r.id,
      filename: r.filename,
      merchant_name: r.merchant_name,
      customer_name: r.customer_name || '',
      invoice_number: r.invoice_number || '',
      date: r.date,
      currency: r.currency || 'USD',
      total_amount: r.total_amount !== null && r.total_amount !== '' ? Number(r.total_amount) : null,
      extraction_method: r.extraction_method || 'Native PDF',
      confidence: r.confidence ?? 100,
      status: r.status || 'success',
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  triggerDownload(blob, customFilename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
