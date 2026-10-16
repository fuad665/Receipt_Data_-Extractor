import * as XLSX from 'xlsx';
import { checkBackendHealth } from './pdfExtractor';

/**
 * Computes Customer Loyalty / Repeat Customer analysis and Payment Date Timeline
 * from a list of receipt records.
 */
export function buildAnalyticsData(records) {
  const validRecords = (records || []).filter(
    (r) => r.merchant_name && r.merchant_name !== 'Invalid File Type' && r.merchant_name !== 'Corrupted PDF File'
  );

  const totalRevenue = validRecords.reduce((sum, r) => {
    const val = parseFloat(r.total_amount);
    return sum + (Number.isNaN(val) ? 0 : val);
  }, 0);

  // 1. Group by Customer / Merchant (normalized key)
  const customerMap = new Map();
  for (const rec of validRecords) {
    const rawName = (rec.merchant_name || 'Unknown Customer').trim();
    const key = rawName.toLowerCase().replace(/\s+/g, ' ');
    const amount = parseFloat(rec.total_amount);
    const numericAmount = Number.isNaN(amount) ? 0 : amount;
    const dateStr = (rec.date || '').trim();

    if (!customerMap.has(key)) {
      customerMap.set(key, {
        key,
        name: rawName,
        customerSubName: rec.customer_name || '',
        paymentCount: 0,
        totalPaid: 0,
        currency: rec.currency || 'USD',
        dates: [],
        invoices: [],
        records: [],
      });
    }

    const entry = customerMap.get(key);
    entry.paymentCount += 1;
    entry.totalPaid = Math.round((entry.totalPaid + numericAmount) * 100) / 100;
    if (dateStr) entry.dates.push(dateStr);
    if (rec.invoice_number) entry.invoices.push(rec.invoice_number);
    entry.records.push(rec);
  }

  const customers = Array.from(customerMap.values())
    .map((c) => {
      const sortedDates = [...c.dates].sort();
      const uniqueDates = [...new Set(sortedDates)];
      const isRepeat = c.paymentCount >= 2;
      const avgPayment = c.paymentCount > 0 ? Math.round((c.totalPaid / c.paymentCount) * 100) / 100 : 0;
      const revenueShare = totalRevenue > 0 ? Math.round((c.totalPaid / totalRevenue) * 1000) / 10 : 0;

      return {
        ...c,
        isRepeat,
        avgPayment,
        revenueShare,
        sortedDates,
        uniqueDates,
        firstPaymentDate: sortedDates[0] || 'N/A',
        lastPaymentDate: sortedDates[sortedDates.length - 1] || 'N/A',
      };
    })
    .sort((a, b) => {
      if (b.paymentCount !== a.paymentCount) return b.paymentCount - a.paymentCount;
      return b.totalPaid - a.totalPaid;
    });

  // 2. Group by Payment Date
  const dateMap = new Map();
  for (const rec of validRecords) {
    const dateKey = (rec.date || 'Unscheduled / No Date').trim() || 'Unscheduled / No Date';
    const amount = parseFloat(rec.total_amount);
    const numericAmount = Number.isNaN(amount) ? 0 : amount;
    const name = (rec.merchant_name || 'Unknown').trim();

    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, {
        date: dateKey,
        receiptCount: 0,
        totalCollected: 0,
        customers: [],
        records: [],
      });
    }

    const dEntry = dateMap.get(dateKey);
    dEntry.receiptCount += 1;
    dEntry.totalCollected = Math.round((dEntry.totalCollected + numericAmount) * 100) / 100;
    dEntry.customers.push({
      name,
      amount: numericAmount,
      invoice: rec.invoice_number || '',
    });
    dEntry.records.push(rec);
  }

  const timeline = Array.from(dateMap.values()).sort((a, b) => {
    if (a.date === 'Unscheduled / No Date') return 1;
    if (b.date === 'Unscheduled / No Date') return -1;
    return b.date.localeCompare(a.date); // Most recent first
  });

  const maxDateAmount = timeline.reduce((max, d) => Math.max(max, d.totalCollected), 0);

  const repeatCustomers = customers.filter((c) => c.isRepeat);
  const oneTimeCustomers = customers.filter((c) => !c.isRepeat);
  const repeatRevenue = repeatCustomers.reduce((sum, c) => sum + c.totalPaid, 0);
  const repeatRate =
    customers.length > 0 ? Math.round((repeatCustomers.length / customers.length) * 100) : 0;

  const peakDate =
    timeline.length > 0
      ? [...timeline].sort((a, b) => b.totalCollected - a.totalCollected)[0]
      : null;

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCustomers: customers.length,
    repeatCustomersCount: repeatCustomers.length,
    oneTimeCustomersCount: oneTimeCustomers.length,
    repeatRevenue: Math.round(repeatRevenue * 100) / 100,
    repeatRate,
    topCustomer: customers.length > 0 ? [...customers].sort((a, b) => b.totalPaid - a.totalPaid)[0] : null,
    peakDate,
    maxDateAmount,
    customers,
    timeline,
  };
}

/**
 * Imports an existing Excel (.xlsx / .xls / .csv) file so users can analyze
 * raw Excel receipt data directly in the dashboard.
 */
export async function importExcelFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const worksheet = workbook.Sheets[firstSheetName];
  const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const importedRecords = [];
  for (const row of jsonRows) {
    // Skip summary rows
    const fileVal = String(row['File Name'] || row['filename'] || row['File'] || '');
    if (fileVal.toUpperCase().startsWith('TOTAL (')) continue;

    const merchant =
      row['Customer / Merchant Name'] ||
      row['Customer Name'] ||
      row['Merchant Name'] ||
      row['Customer'] ||
      row['Merchant'] ||
      row['Vendor'] ||
      row['merchant_name'] ||
      '';

    const dateRaw =
      row['Date'] ||
      row['Invoice Date'] ||
      row['Payment Date'] ||
      row['Transaction Date'] ||
      row['date'] ||
      '';

    const amountRaw =
      row['Total Amount'] ??
      row['Amount'] ??
      row['Total'] ??
      row['Grand Total'] ??
      row['total_amount'] ??
      null;

    if (!merchant && !dateRaw && (amountRaw === null || amountRaw === '')) continue;

    let parsedAmount = null;
    if (amountRaw !== null && amountRaw !== '') {
      const cleaned = String(amountRaw).replace(/[^0-9.\-]/g, '');
      const num = parseFloat(cleaned);
      if (!Number.isNaN(num)) parsedAmount = Math.round(num * 100) / 100;
    }

    importedRecords.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      filename: fileVal || file.name,
      merchant_name: String(merchant || 'Unknown Customer').trim(),
      customer_name: String(row['Customer (Billed To)'] || row['customer_name'] || '').trim(),
      invoice_number: String(row['Invoice / Receipt #'] || row['Invoice #'] || row['invoice_number'] || '').trim(),
      date: String(dateRaw).trim(),
      raw_date: String(dateRaw).trim(),
      total_amount: parsedAmount,
      currency: String(row['Currency'] || row['currency'] || 'USD').trim() || 'USD',
      extraction_method: 'Excel Import',
      confidence: 100,
      status: merchant && dateRaw && parsedAmount !== null ? 'success' : 'partial',
      raw_text: `Imported from Excel file: ${file.name}`,
      error_message: '',
    });
  }

  return importedRecords;
}

/**
 * Exports records to a multi-sheet Excel (.xlsx) workbook:
 * Sheet 1: Extracted Receipts (Raw Data)
 * Sheet 2: Customer Repeat Analysis (Repeating vs One-time customers, payment counts, dates)
 * Sheet 3: Payment Date Monitor (Payments grouped by date)
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

  const analytics = buildAnalyticsData(records);

  // Sheet 1: Extracted Receipts
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

  const wsReceipts = XLSX.utils.json_to_sheet(rows);
  wsReceipts['!cols'] = [
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

  // Sheet 2: Customer Repeat Analysis
  const customerRows = analytics.customers.map((c, idx) => ({
    '#': idx + 1,
    'Customer / Merchant Name': c.name,
    'Customer Type': c.isRepeat ? `REPEAT CUSTOMER (${c.paymentCount}x)` : 'One-Time Customer',
    'Total Payments Count': c.paymentCount,
    'Total Amount Paid': c.totalPaid,
    'Average Payment': c.avgPayment,
    'Revenue Share (%)': `${c.revenueShare}%`,
    'First Payment Date': c.firstPaymentDate,
    'Latest Payment Date': c.lastPaymentDate,
    'All Payment Dates': c.sortedDates.join(', '),
  }));

  const wsCustomers = XLSX.utils.json_to_sheet(customerRows);
  wsCustomers['!cols'] = [
    { wch: 6 },
    { wch: 30 },
    { wch: 26 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 36 },
  ];

  // Sheet 3: Payment Date Monitor
  const dateRows = analytics.timeline.map((d, idx) => ({
    '#': idx + 1,
    'Payment Date': d.date,
    'Number of Payments': d.receiptCount,
    'Total Amount Collected': d.totalCollected,
    'Customers Who Paid': d.customers.map((c) => `${c.name} ($${c.amount.toFixed(2)})`).join('; '),
  }));

  const wsDates = XLSX.utils.json_to_sheet(dateRows);
  wsDates['!cols'] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 20 },
    { wch: 22 },
    { wch: 55 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, wsReceipts, 'Extracted Receipts');
  XLSX.utils.book_append_sheet(workbook, wsCustomers, 'Customer Repeat Analysis');
  XLSX.utils.book_append_sheet(workbook, wsDates, 'Payment Date Monitor');
  XLSX.writeFile(workbook, customFilename);
}

/**
 * Exports records and customer/date analytics to a formatted JSON (.json) file.
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

  const analytics = buildAnalyticsData(records);

  const payload = {
    exported_at: new Date().toISOString(),
    summary: {
      total_receipts: records.length,
      aggregate_amount: analytics.totalRevenue,
      unique_customers: analytics.totalCustomers,
      repeat_customers: analytics.repeatCustomersCount,
      repeat_customer_rate_percent: analytics.repeatRate,
    },
    customer_analysis: analytics.customers.map((c) => ({
      customer_name: c.name,
      is_repeat_customer: c.isRepeat,
      payment_count: c.paymentCount,
      total_paid: c.totalPaid,
      average_payment: c.avgPayment,
      first_payment_date: c.firstPaymentDate,
      last_payment_date: c.lastPaymentDate,
      payment_dates: c.sortedDates,
    })),
    payment_date_monitor: analytics.timeline.map((d) => ({
      date: d.date,
      receipt_count: d.receiptCount,
      total_collected: d.totalCollected,
      customers: d.customers,
    })),
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
