# Receipt Data Extractor MVP

A modern, responsive Full-Stack Web Application that allows users to upload single or multiple PDF receipts and invoices, automatically extract key fields (**Customer / Merchant Name**, **Date**, and **Total Amount**) across diverse layouts, review and inline-edit extracted records, and export to **Excel (`.xlsx`)** or **JSON (`.json`)**.

---

## ✨ Key Features

1. **PDF Upload & Automated Processing**
   - Drag-and-drop or file picker supporting single and batch PDF receipt/invoice uploads.
   - **Native PDF Parsing**: Uses `pdfplumber` and `pypdf` (with `PyMuPDF` & `PDF.js` coordinate-aware line reconstruction) for fast, accurate text extraction from digital PDFs.
   - **Automatic OCR Fallback**: Detects scanned/image-based PDFs and automatically falls back to `pdf2image` + `pytesseract` (and `Tesseract.js` in-browser OCR fallback).
   - **Built-in Sample PDF Generator**: Includes one-click sample PDF generation (AWS Cloud Invoice, Whole Foods Receipt, Figma Enterprise Invoice, Apple Store Receipt, and a Scanned Image-only OCR Receipt) for instant testing.

2. **Smart & Flexible Field Extraction**
   - **Customer / Merchant Name**: Extracts explicit labels (`Vendor:`, `Merchant:`, `Store Name:`, `Issued By:`, `Billed To:`, `Customer Name:`) as well as top-of-receipt header heuristics while filtering out generic document titles (`TAX INVOICE`, `CASH RECEIPT`, addresses, phone numbers).
   - **Multi-Format Date Normalization**: Parses and normalizes `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, `MMM DD, YYYY` (e.g., `October 12, 2026`), and `DD MMM YYYY` (e.g., `09 Oct 2026`) into standard `YYYY-MM-DD` while preserving the raw matched date string.
   - **Total Amount & Currency Detection**: Tiered priority matching for `Grand Total`, `Amount Due`, `Balance Due`, `Net Total`, `Total Paid`, and `Total` while ignoring `Subtotal`, `Tax`, and `Discount` lines. Supports multiple currencies (`USD`, `EUR`, `GBP`, `CAD`, `AUD`, `JPY`, `INR`, `AED`, `SAR`, `MYR`, `SGD`).

3. **Interactive Data Table & Inline Review**
   - Click any **Merchant / Customer Name**, **Date**, or **Total Amount / Currency** cell to edit values inline.
   - **Raw Text Inspector Modal**: Click **Inspect** on any row to view the full extracted PDF/OCR text side-by-side with the editable fields.
   - Search across all fields and filter by extraction status (`All`, `Complete`, `Review`, `Error`).

4. **One-Click Export (`.xlsx` & `.json`)**
   - Export selected rows or all records to a formatted **Excel (`.xlsx`)** spreadsheet (with styled headers, numeric currency formatting, and an automatic summary row) or structured **JSON (`.json`)**.

5. **Real-Time KPI Dashboard**
   - Displays **Total Receipts Processed** (Native vs. OCR breakdown), **Aggregate Total Amount**, **Extraction Success Rate**, and **Quick Export** controls.

---

## 🗂️ Project Structure

```text
Recipte Data Extractor/
├── backend/
│   ├── main.py            # FastAPI application & REST endpoints (/api/extract, /api/export/excel, /api/export/json)
│   ├── extractor.py       # Native PDF (pdfplumber/pypdf) + OCR (pdf2image/pytesseract) + Regex/Heuristic parser
│   ├── exporter.py        # Excel (.xlsx) generator (pandas + openpyxl) & JSON formatter
│   └── requirements.txt   # Python backend dependencies
├── frontend/
│   ├── src/
│   │   ├── App.jsx                # Main responsive dashboard, uploader, inline-editable table & inspector modal
│   │   ├── utils/pdfExtractor.js  # FastAPI client + browser PDF.js & Tesseract OCR fallback engine
│   │   ├── utils/exportUtils.js   # Excel (.xlsx) & JSON export handlers
│   │   └── utils/sampleReceipts.js# Multi-layout sample PDF & scanned OCR PDF generator
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.js
└── README.md
```

---

## 🚀 Getting Started

### 1. Start the Frontend (React + Vite + Tailwind CSS)

```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser.

> **Note:** The frontend includes a dual-engine architecture. It automatically connects to the Python FastAPI backend on `http://localhost:8000` when running, and seamlessly falls back to its built-in client-side `PDF.js` + `Tesseract.js` + `SheetJS` engine if the Python server is offline.

### 2. Start the Backend (Python FastAPI)

Ensure Python 3.10+ (and optionally Tesseract OCR / Poppler for system-level OCR) is installed:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The FastAPI interactive Swagger documentation will be available at **`http://localhost:8000/docs`**.
