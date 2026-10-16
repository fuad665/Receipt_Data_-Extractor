import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import Tesseract from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const CURRENCY_MAP = {
  '$': 'USD',
  'US$': 'USD',
  'USD': 'USD',
  '€': 'EUR',
  'EUR': 'EUR',
  '£': 'GBP',
  'GBP': 'GBP',
  '¥': 'JPY',
  'JPY': 'JPY',
  'CAD': 'CAD',
  'C$': 'CAD',
  'AUD': 'AUD',
  'A$': 'AUD',
  'CHF': 'CHF',
  'AED': 'AED',
  'SAR': 'SAR',
  'INR': 'INR',
  '₹': 'INR',
  'RM': 'MYR',
  'MYR': 'MYR',
  'SGD': 'SGD',
  'S$': 'SGD',
};

const MONTH_MAP = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

const IGNORE_HEADER_PATTERNS = [
  /^invoice\b/i,
  /^receipt\b/i,
  /^tax\s+invoice\b/i,
  /^cash\s+receipt\b/i,
  /^sales\s+receipt\b/i,
  /^payment\s+receipt\b/i,
  /^billing\s+statement\b/i,
  /^order\s+confirmation\b/i,
  /^statement\b/i,
  /^page\s+\d+/i,
  /^date\s*[:\-]/i,
  /^time\s*[:\-]/i,
  /^tel\s*[:\-]/i,
  /^phone\s*[:\-]/i,
  /^www\./i,
  /^http/i,
  /^\d+\s*$/,
  /^thank\s+you/i,
];

/**
 * Checks if the Python FastAPI backend is reachable.
 */
export async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch('/api/health', { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Processes an array of PDF File objects via FastAPI backend first,
 * or falls back to local PDF.js + Tesseract.js OCR extraction if backend is offline.
 */
export async function processPdfFiles(files, onProgress) {
  const isBackendUp = await checkBackendHealth();

  if (isBackendUp) {
    try {
      if (onProgress) onProgress({ stage: 'Uploading to FastAPI Backend...', percent: 25 });
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));

      const response = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (onProgress) onProgress({ stage: 'Extraction complete', percent: 100 });
        return {
          results: data.results || [],
          engine: 'FastAPI Backend (pdfplumber + pytesseract)',
        };
      }
    } catch (err) {
      console.warn('FastAPI request failed, falling back to browser PDF+OCR engine:', err);
    }
  }

  // Fallback / Direct Browser Engine (PDF.js Native Text + Tesseract.js OCR)
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const basePercent = Math.round((i / files.length) * 100);
    if (onProgress) {
      onProgress({
        stage: `Processing ${file.name} (${i + 1} of ${files.length})...`,
        percent: Math.max(10, basePercent),
      });
    }
    const record = await extractSinglePdfClient(file, (subStage) => {
      if (onProgress) {
        onProgress({
          stage: `${file.name}: ${subStage}`,
          percent: Math.min(95, basePercent + Math.round(50 / files.length)),
        });
      }
    });
    results.push(record);
  }

  if (onProgress) onProgress({ stage: 'Extraction complete', percent: 100 });
  return {
    results,
    engine: 'Smart Browser Engine (PDF.js + Tesseract OCR)',
  };
}

/**
 * Extracts text from a single PDF file using PDF.js with Y-coordinate line reconstruction,
 * falling back to Canvas rendering + Tesseract.js OCR if scanned/image-based.
 */
async function extractSinglePdfClient(file, onSubStage) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const filename = file.name || 'receipt.pdf';

  if (!filename.toLowerCase().endsWith('.pdf')) {
    return {
      id,
      filename,
      merchant_name: 'Invalid File Type',
      customer_name: '',
      invoice_number: '',
      date: '',
      raw_date: '',
      total_amount: null,
      currency: 'USD',
      extraction_method: 'Error',
      confidence: 0,
      status: 'error',
      raw_text: '',
      error_message: 'Only PDF (.pdf) files are supported.',
    };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
    const headerStr = String.fromCharCode(...headerBytes);
    if (!headerStr.startsWith('%PDF')) {
      return {
        id,
        filename,
        merchant_name: 'Corrupted PDF File',
        customer_name: '',
        invoice_number: '',
        date: '',
        raw_date: '',
        total_amount: null,
        currency: 'USD',
        extraction_method: 'Error',
        confidence: 0,
        status: 'error',
        raw_text: '',
        error_message: 'File header is corrupted or not a valid PDF document.',
      };
    }

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;

    let nativeTextPages = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Reconstruct lines accurately using Y coordinates
      const rowMap = new Map();
      for (const item of textContent.items) {
        if (!item.str) continue;
        const y = Math.round(item.transform[5] / 3) * 3; // Group items within 3pt vertically
        if (!rowMap.has(y)) rowMap.set(y, []);
        rowMap.get(y).push({ x: item.transform[4], str: item.str });
      }

      // Sort rows top-to-bottom (descending Y in PDF coordinate space)
      const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a);
      const pageLines = sortedYs.map((y) => {
        const items = rowMap.get(y).sort((a, b) => a.x - b.x);
        return items.map((it) => it.str).join('  ').trim();
      });

      nativeTextPages.push(pageLines.filter(Boolean).join('\n'));
    }

    let extractedText = nativeTextPages.join('\n').trim();
    let extractionMethod = 'Native PDF Parser';

    // Fallback to OCR if scanned / image-based PDF (fewer than 20 characters of text)
    if (extractedText.replace(/\s+/g, '').length < 20) {
      if (onSubStage) onSubStage('Scanned PDF detected — running OCR fallback...');
      const ocrPages = [];
      for (let pageNum = 1; pageNum <= Math.min(numPages, 3); pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        const { data } = await Tesseract.recognize(dataUrl, 'eng');
        if (data && data.text) {
          ocrPages.push(data.text);
        }
      }
      const ocrText = ocrPages.join('\n').trim();
      if (ocrText.length > extractedText.length) {
        extractedText = ocrText;
        extractionMethod = 'OCR Fallback (Tesseract)';
      }
    }

    if (!extractedText) {
      return {
        id,
        filename,
        merchant_name: 'Unreadable PDF (Manual Edit Needed)',
        customer_name: '',
        invoice_number: '',
        date: '',
        raw_date: '',
        total_amount: null,
        currency: 'USD',
        extraction_method: extractionMethod,
        page_count: numPages,
        confidence: 0,
        status: 'partial',
        raw_text: '',
        error_message: 'No readable text could be extracted via native parser or OCR.',
      };
    }

    const parsed = parseReceiptText(extractedText, filename);
    return {
      id,
      filename,
      merchant_name: parsed.merchant_name,
      customer_name: parsed.customer_name,
      invoice_number: parsed.invoice_number,
      date: parsed.date,
      raw_date: parsed.raw_date,
      total_amount: parsed.total_amount,
      currency: parsed.currency,
      extraction_method: extractionMethod,
      page_count: numPages,
      confidence: parsed.confidence,
      status: parsed.status,
      raw_text: extractedText,
      error_message: parsed.status === 'success' ? '' : 'Review highlighted fields for accuracy.',
    };
  } catch (err) {
    return {
      id,
      filename,
      merchant_name: 'Corrupted or Protected PDF',
      customer_name: '',
      invoice_number: '',
      date: '',
      raw_date: '',
      total_amount: null,
      currency: 'USD',
      extraction_method: 'Error',
      confidence: 0,
      status: 'error',
      raw_text: '',
      error_message: err?.message || 'Failed to parse PDF document.',
    };
  }
}

/**
 * Smart Regex + Heuristic Parser for Receipt / Invoice Text
 */
export function parseReceiptText(text, filename = '') {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const { merchant, customer } = extractMerchantAndCustomer(lines, text, filename);
  const { normalizedDate, rawDate } = extractDate(text, lines);
  const { totalAmount, currency } = extractTotalAmount(text, lines);
  const invoiceNumber = extractInvoiceNumber(text);

  let foundFields = 0;
  if (merchant && merchant !== 'Unknown Merchant') foundFields++;
  if (normalizedDate) foundFields++;
  if (totalAmount !== null && !Number.isNaN(totalAmount)) foundFields++;

  const confidence = Math.round((foundFields / 3) * 100);
  const status = foundFields === 3 ? 'success' : foundFields > 0 ? 'partial' : 'error';

  return {
    merchant_name: merchant || 'Unknown Merchant',
    customer_name: customer || '',
    invoice_number: invoiceNumber || '',
    date: normalizedDate || '',
    raw_date: rawDate || '',
    total_amount: totalAmount,
    currency: currency || 'USD',
    confidence,
    status,
  };
}

function cleanEntityName(raw) {
  if (!raw) return '';
  let cleaned = raw.split(/\s{2,}(?:Invoice|Receipt|Date|Order|Bill|Tax|Tel|Phone|No\.|#)\b/i)[0];
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/^[\s:\-|*,.]+|[\s:\-|*,.]+$/g, '');
  return cleaned.slice(0, 65);
}

function extractMerchantAndCustomer(lines, fullText, filename) {
  let merchant = '';
  let customer = '';

  // 1. Explicit Vendor / Merchant label
  const merchantMatch = fullText.match(
    /(?:Merchant|Vendor|Store(?:\s+Name)?|From|Seller|Sold\s+By|Company|Issued\s+By)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\s&.,'\-()]{2,60})/i
  );
  if (merchantMatch) {
    merchant = cleanEntityName(merchantMatch[1].split(/\r?\n/)[0]);
  }

  // 2. Explicit Customer / Billed To label
  const customerMatch = fullText.match(
    /(?:Bill(?:ed)?\s+To|Customer(?:\s+Name)?|Client(?:\s+Name)?|Sold\s+To|Prepared\s+For)\s*[:\-]?\s*\n?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'\-()]{2,60})/i
  );
  if (customerMatch) {
    const candidate = cleanEntityName(customerMatch[1].split(/\r?\n/)[0]);
    if (candidate && !/^(?:date|invoice|receipt|address|phone|email)\b/i.test(candidate)) {
      customer = candidate;
    }
  }

  // 3. Top-of-document header heuristic
  if (!merchant) {
    for (const line of lines.slice(0, 10)) {
      const candidate = cleanEntityName(line);
      if (!candidate || candidate.length < 2) continue;
      if (IGNORE_HEADER_PATTERNS.some((rx) => rx.test(candidate))) continue;

      const alphaCount = (candidate.match(/[A-Za-z]/g) || []).length;
      if (alphaCount < 3 || alphaCount / candidate.length < 0.4) continue;
      if (/^\d+\s+[A-Za-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Way)\b/i.test(candidate)) {
        continue;
      }
      merchant = candidate;
      break;
    }
  }

  if (!merchant && customer) {
    merchant = customer;
    customer = '';
  }

  if (!merchant && filename) {
    merchant = filename
      .replace(/\.pdf$/i, '')
      .replace(/[_\-]+/g, ' ')
      .trim();
  }

  return { merchant: merchant || 'Unknown Merchant', customer };
}

function extractDate(fullText, lines) {
  const monthNames =
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  const datePatterns = [
    // YYYY-MM-DD or YYYY/MM/DD
    new RegExp('\\b(20\\d{2}|19\\d{2})[\\-/\\.](0?[1-9]|1[0-2])[\\-/\\.](0?[1-9]|[12]\\d|3[01])\\b', 'i'),
    // MMM DD, YYYY
    new RegExp(`\\b(${monthNames})\\.?\\s+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?,?\\s+(20\\d{2}|19\\d{2})\\b`, 'i'),
    // DD MMM YYYY or DD-MMM-YYYY
    new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])[\\s\\-/\\.]*(${monthNames})\\.?[\\s\\-/,\\.]*(20\\d{2}|19\\d{2}|\\d{2})\\b`, 'i'),
    // DD/MM/YYYY or MM/DD/YYYY
    new RegExp('\\b(0?[1-9]|[12]\\d|3[01])[\\/\\-\\.](0?[1-9]|[12]\\d|3[01])[\\/\\-\\.](20\\d{2}|19\\d{2}|\\d{2})\\b', 'i'),
  ];

  // 1. Check labeled date lines first
  const labeledRx =
    /(?:Invoice\s+Date|Receipt\s+Date|Transaction\s+Date|Order\s+Date|Date\s+of\s+Issue|Issued\s+Date|Date)\s*[:\-]?\s*([^\n]{5,40})/gi;
  let m;
  while ((m = labeledRx.exec(fullText)) !== null) {
    const snippet = m[1];
    for (const dp of datePatterns) {
      const dm = snippet.match(dp);
      if (dm) {
        return {
          normalizedDate: normalizeDateString(dm[0]),
          rawDate: dm[0],
        };
      }
    }
  }

  // 2. Scan lines (skipping Due Date on first pass)
  for (const line of lines) {
    if (/\b(?:due\s+date|payment\s+due|valid\s+until)\b/i.test(line)) continue;
    for (const dp of datePatterns) {
      const dm = line.match(dp);
      if (dm) {
        return {
          normalizedDate: normalizeDateString(dm[0]),
          rawDate: dm[0],
        };
      }
    }
  }

  // 3. Fallback anywhere in text
  for (const dp of datePatterns) {
    const dm = fullText.match(dp);
    if (dm) {
      return {
        normalizedDate: normalizeDateString(dm[0]),
        rawDate: dm[0],
      };
    }
  }

  return { normalizedDate: '', rawDate: '' };
}

function normalizeDateString(raw) {
  if (!raw) return '';
  const s = raw.replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1').trim();

  // ISO YYYY-MM-DD
  let m = s.match(/^(20\d{2}|19\d{2})[\-/\.](0?[1-9]|1[0-2])[\-/\.](0?[1-9]|[12]\d|3[01])$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  // MMM DD, YYYY
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2}|19\d{2})$/);
  if (m) {
    const mon = MONTH_MAP[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  }

  // DD MMM YYYY or DD-MMM-YY
  m = s.match(/^(\d{1,2})[\s\-/\.]+([A-Za-z]+)\.?[\s\-/,\.]+(\d{2,4})$/);
  if (m) {
    const mon = MONTH_MAP[m[2].toLowerCase()];
    let yr = m[3];
    if (yr.length === 2) yr = Number(yr) > 50 ? `19${yr}` : `20${yr}`;
    if (mon) return `${yr}-${mon}-${m[1].padStart(2, '0')}`;
  }

  // Numeric slash/dash: MM/DD/YYYY or DD/MM/YYYY
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let p1 = parseInt(m[1], 10);
    let p2 = parseInt(m[2], 10);
    let yr = m[3];
    if (yr.length === 2) yr = Number(yr) > 50 ? `19${yr}` : `20${yr}`;

    let month, day;
    if (p1 > 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12) {
      month = p1;
      day = p2;
    } else {
      // Default to MM/DD/YYYY unless dot-separated (European DD.MM.YYYY)
      if (s.includes('.')) {
        day = p1;
        month = p2;
      } else {
        month = p1;
        day = p2;
      }
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return s;
}

function extractTotalAmount(fullText, lines) {
  const detectedCurrency = detectCurrency(fullText);
  const amountRegex =
    /(US\$|C\$|A\$|S\$|USD|EUR|GBP|CAD|AUD|CHF|AED|SAR|INR|MYR|SGD|JPY|RM|[\$€£¥₹])?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\d+\.\d{2}|\d{1,3}(?:\.\d{3})+,\d{2})/gi;

  const tier1Rx =
    /(?:Grand\s+Total|Total\s+Amount\s+Due|Amount\s+Due|Balance\s+Due|Total\s+Due|Total\s+Paid|Net\s+Total|Invoice\s+Total|Order\s+Total|Total\s+Amount|Amount\s+Paid|Total\s+Charged|Total\s+\([A-Z]{3}\))/i;

  const tier1Candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (tier1Rx.test(line) && !/\bsub[\s\-]?total\b/i.test(line)) {
      const found = extractAmountFromLineOrNext(lines, i, amountRegex);
      if (found) {
        tier1Candidates.push({
          amount: found.amount,
          currency: found.currency || detectedCurrency,
        });
      }
    }
  }
  if (tier1Candidates.length > 0) {
    const chosen = tier1Candidates[tier1Candidates.length - 1];
    return { totalAmount: chosen.amount, currency: chosen.currency };
  }

  // Tier 2: Generic Total (excluding Subtotal, Tax Total, Discount Total)
  const tier2Candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /\bTotal\b/i.test(line) &&
      !/\b(?:sub[\s\-]?total|tax\s+total|total\s+tax|vat\s+total|discount\s+total|total\s+discount|total\s+items|total\s+qty|total\s+savings)\b/i.test(
        line
      )
    ) {
      const found = extractAmountFromLineOrNext(lines, i, amountRegex);
      if (found) {
        tier2Candidates.push({
          amount: found.amount,
          currency: found.currency || detectedCurrency,
        });
      }
    }
  }
  if (tier2Candidates.length > 0) {
    const best = tier2Candidates.reduce((max, curr) => (curr.amount >= max.amount ? curr : max), tier2Candidates[0]);
    return { totalAmount: best.amount, currency: best.currency };
  }

  // Tier 3: Bottom-half largest currency amount fallback
  const fallbackCandidates = [];
  const startIdx = Math.floor(lines.length / 2);
  for (let i = startIdx; i < lines.length; i++) {
    const matches = [...lines[i].matchAll(amountRegex)];
    for (const m of matches) {
      const val = parseFormattedNumber(m[2]);
      const currRaw = (m[1] || '').trim();
      const curr = CURRENCY_MAP[currRaw.toUpperCase()] || CURRENCY_MAP[currRaw] || detectedCurrency;
      if (val !== null && val > 0 && val < 10000000) {
        fallbackCandidates.push({ amount: val, currency: curr });
      }
    }
  }
  if (fallbackCandidates.length > 0) {
    const best = fallbackCandidates.reduce((max, c) => (c.amount >= max.amount ? c : max), fallbackCandidates[0]);
    return { totalAmount: best.amount, currency: best.currency };
  }

  return { totalAmount: null, currency: detectedCurrency };
}

function extractAmountFromLineOrNext(lines, idx, amountRegex) {
  const matches = [...lines[idx].matchAll(amountRegex)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const amount = parseFormattedNumber(last[2]);
    const currRaw = (last[1] || '').trim();
    const currency = CURRENCY_MAP[currRaw.toUpperCase()] || CURRENCY_MAP[currRaw] || '';
    if (amount !== null) return { amount, currency };
  }

  if (idx + 1 < lines.length && lines[idx + 1].length < 28) {
    const nextMatches = [...lines[idx + 1].matchAll(amountRegex)];
    if (nextMatches.length > 0) {
      const last = nextMatches[nextMatches.length - 1];
      const amount = parseFormattedNumber(last[2]);
      const currRaw = (last[1] || '').trim();
      const currency = CURRENCY_MAP[currRaw.toUpperCase()] || CURRENCY_MAP[currRaw] || '';
      if (amount !== null) return { amount, currency };
    }
  }
  return null;
}

function parseFormattedNumber(numStr) {
  if (!numStr) return null;
  let s = numStr.trim().replace(/\s+/g, '');
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',') && /,\d{2}$/.test(s)) {
    s = s.replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const parsed = parseFloat(s);
  return Number.isNaN(parsed) ? null : Math.round(parsed * 100) / 100;
}

function detectCurrency(text) {
  const checks = [
    ['USD', 'USD'],
    ['EUR', 'EUR'],
    ['GBP', 'GBP'],
    ['CAD', 'CAD'],
    ['AUD', 'AUD'],
    ['SGD', 'SGD'],
    ['MYR', 'MYR'],
    ['AED', 'AED'],
    ['SAR', 'SAR'],
    ['INR', 'INR'],
    ['€', 'EUR'],
    ['£', 'GBP'],
    ['₹', 'INR'],
    ['¥', 'JPY'],
    ['$', 'USD'],
  ];
  for (const [token, iso] of checks) {
    if (text.includes(token)) return iso;
  }
  return 'USD';
}

function extractInvoiceNumber(text) {
  const patterns = [
    /(?:Invoice|Receipt|Order|Transaction)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]{3,25})/i,
    /\b(INV[\-\s#]*\d{3,15})\b/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1] && !/^(?:date|total|amount|to|from)$/i.test(m[1])) {
      return m[1].trim();
    }
  }
  return '';
}
