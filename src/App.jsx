import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Download,
  FileSpreadsheet,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Trash2,
  Eye,
  Plus,
  Sparkles,
  ScanLine,
  RefreshCw,
  Check,
  Edit3,
  DollarSign,
  Calendar,
  Building2,
  Filter,
  X,
  Receipt,
  ShieldCheck,
  BarChart3,
  Users,
  Repeat,
  TrendingUp,
  Clock,
  ArrowUpRight,
} from 'lucide-react';
import { processPdfFiles, checkBackendHealth } from './utils/pdfExtractor';
import {
  exportToExcel,
  exportToJson,
  buildAnalyticsData,
  importExcelFile,
} from './utils/exportUtils';
import { generateSamplePdfFiles } from './utils/sampleReceipts';

const STORAGE_KEY = 'receipt_data_extractor_records_v1';

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
  INR: '₹',
  AED: 'AED ',
  SAR: 'SAR ',
  MYR: 'RM',
  SGD: 'S$',
};

export default function App() {
  const [records, setRecords] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [activeTab, setActiveTab] = useState('table'); // 'table' | 'analysis'
  const [customerFilter, setCustomerFilter] = useState('all'); // 'all' | 'repeat' | 'onetime'
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ stage: '', percent: 0 });
  const [notification, setNotification] = useState(null);
  const [inspectRecord, setInspectRecord] = useState(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [editingCell, setEditingCell] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (e) {
      console.warn('Failed to save to sessionStorage:', e);
    }
  }, [records]);

  useEffect(() => {
    checkBackendHealth().then(setBackendConnected);
  }, []);

  const showToast = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // Handle PDF and Excel (.xlsx / .csv) File Uploads
  const handleFilesUpload = async (fileList) => {
    const filesArray = Array.from(fileList || []);
    if (filesArray.length === 0) return;

    setIsProcessing(true);
    setProgress({ stage: `Preparing ${filesArray.length} file(s)...`, percent: 10 });

    try {
      const pdfFiles = [];
      const excelFiles = [];

      for (const f of filesArray) {
        const lower = (f.name || '').toLowerCase();
        if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
          excelFiles.push(f);
        } else {
          pdfFiles.push(f);
        }
      }

      let newRecords = [];

      if (excelFiles.length > 0) {
        setProgress({ stage: `Importing raw data from ${excelFiles.length} Excel file(s)...`, percent: 35 });
        for (const ef of excelFiles) {
          const imported = await importExcelFile(ef);
          newRecords.push(...imported);
        }
      }

      if (pdfFiles.length > 0) {
        const { results } = await processPdfFiles(pdfFiles, (prog) => {
          setProgress(prog);
        });
        newRecords.push(...results);
      }

      setRecords((prev) => [...newRecords, ...prev]);

      const successCount = newRecords.filter((r) => r.status === 'success').length;
      const partialCount = newRecords.filter((r) => r.status === 'partial').length;
      const errorCount = newRecords.filter((r) => r.status === 'error').length;

      if (errorCount > 0 && successCount === 0 && partialCount === 0) {
        showToast('error', `Failed to extract data from ${errorCount} file(s). Check file format.`);
      } else if (partialCount > 0 || errorCount > 0) {
        showToast(
          'warning',
          `Processed ${newRecords.length} record(s): ${successCount} complete, ${partialCount + errorCount} flagged for review.`
        );
      } else {
        showToast(
          'success',
          `Successfully extracted ${newRecords.length} receipt record(s)! Open the "Customer & Date Analysis" tab to view insights.`
        );
      }
    } catch (err) {
      showToast('error', `Extraction failed: ${err?.message || 'Unexpected error'}`);
    } finally {
      setIsProcessing(false);
      setProgress({ stage: '', percent: 0 });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Load Sample PDFs (Native with Repeat Customers or Scanned OCR)
  const handleLoadSamples = async (includeOcr = false) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setProgress({
      stage: includeOcr
        ? 'Generating Scanned Image PDF & running OCR fallback...'
        : 'Generating 6 sample PDF receipts (including repeat customers across multiple dates)...',
      percent: 15,
    });

    try {
      const sampleFiles = generateSamplePdfFiles(includeOcr);
      await handleFilesUpload(sampleFiles);
    } catch (err) {
      setIsProcessing(false);
      showToast('error', `Could not load sample PDFs: ${err.message}`);
    }
  };

  // Inline Field Update with automatic status recalculation
  const handleUpdateRecord = (id, field, value) => {
    setRecords((prev) =>
      prev.map((rec) => {
        if (rec.id !== id) return rec;
        const updated = { ...rec, [field]: value };

        if (field === 'total_amount') {
          const cleaned = value === '' || value === null ? null : parseFloat(value);
          updated.total_amount = Number.isNaN(cleaned) ? null : cleaned;
        }

        const hasMerchant =
          Boolean(updated.merchant_name?.trim()) &&
          updated.merchant_name !== 'Unknown Merchant' &&
          updated.merchant_name !== 'Corrupted PDF File' &&
          updated.merchant_name !== 'Invalid File Type';
        const hasDate = Boolean(updated.date?.trim());
        const hasAmount =
          updated.total_amount !== null &&
          updated.total_amount !== '' &&
          !Number.isNaN(Number(updated.total_amount));

        const validCount = [hasMerchant, hasDate, hasAmount].filter(Boolean).length;
        updated.confidence = Math.round((validCount / 3) * 100);
        updated.status = validCount === 3 ? 'success' : validCount > 0 ? 'partial' : 'error';
        if (updated.status === 'success') updated.error_message = '';

        return updated;
      })
    );

    if (inspectRecord && inspectRecord.id === id) {
      setInspectRecord((prev) => ({ ...prev, [field]: value }));
    }
  };

  // Add manual receipt entry
  const handleAddManualRow = () => {
    const newId = crypto.randomUUID ? crypto.randomUUID() : `manual-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    const newRecord = {
      id: newId,
      filename: 'Manual_Entry.pdf',
      merchant_name: 'New Customer / Merchant',
      customer_name: '',
      invoice_number: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      date: today,
      raw_date: today,
      total_amount: 0.0,
      currency: 'USD',
      extraction_method: 'Manual Entry',
      confidence: 100,
      status: 'success',
      raw_text: 'Manually created receipt record.',
      error_message: '',
    };
    setRecords((prev) => [newRecord, ...prev]);
    setActiveTab('table');
    setEditingCell({ id: newId, field: 'merchant_name' });
    showToast('success', 'Added a new editable row. Click any field to customize.');
  };

  const handleDeleteRecord = (id) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (inspectRecord?.id === id) setInspectRecord(null);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setRecords((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    showToast('success', `Removed ${count} selected receipt(s).`);
  };

  const handleClearAll = () => {
    setRecords([]);
    setSelectedIds(new Set());
    sessionStorage.removeItem(STORAGE_KEY);
    showToast('success', 'Cleared all receipt records.');
  };

  // Filtered records for the table
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      const matchesStatus = statusFilter === 'all' || rec.status === statusFilter;
      if (!matchesStatus) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (rec.merchant_name || '').toLowerCase().includes(q) ||
        (rec.customer_name || '').toLowerCase().includes(q) ||
        (rec.filename || '').toLowerCase().includes(q) ||
        (rec.invoice_number || '').toLowerCase().includes(q) ||
        (rec.date || '').toLowerCase().includes(q) ||
        String(rec.total_amount ?? '').includes(q)
      );
    });
  }, [records, searchQuery, statusFilter]);

  // Dashboard Summary Metrics
  const stats = useMemo(() => {
    const totalReceipts = records.length;
    const aggregateAmount = records.reduce((sum, r) => {
      const val = parseFloat(r.total_amount);
      return sum + (Number.isNaN(val) ? 0 : val);
    }, 0);
    const successCount = records.filter((r) => r.status === 'success').length;
    const partialCount = records.filter((r) => r.status === 'partial').length;
    const errorCount = records.filter((r) => r.status === 'error').length;
    const ocrCount = records.filter((r) =>
      (r.extraction_method || '').toLowerCase().includes('ocr')
    ).length;
    const successRate =
      totalReceipts > 0 ? Math.round((successCount / totalReceipts) * 100) : 100;

    return {
      totalReceipts,
      aggregateAmount,
      successCount,
      partialCount,
      errorCount,
      ocrCount,
      successRate,
    };
  }, [records]);

  // Customer & Payment Date Analytics
  const analytics = useMemo(() => buildAnalyticsData(records), [records]);

  const filteredCustomers = useMemo(() => {
    if (customerFilter === 'repeat') return analytics.customers.filter((c) => c.isRepeat);
    if (customerFilter === 'onetime') return analytics.customers.filter((c) => !c.isRepeat);
    return analytics.customers;
  }, [analytics.customers, customerFilter]);

  // Records targeted for export
  const recordsToExport = useMemo(() => {
    if (selectedIds.size > 0) {
      return records.filter((r) => selectedIds.has(r.id));
    }
    return filteredRecords;
  }, [records, filteredRecords, selectedIds]);

  const toggleSelectAll = () => {
    if (filteredRecords.length === 0) return;
    const allFilteredSelected = filteredRecords.every((r) => selectedIds.has(r.id));
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      filteredRecords.forEach((r) => next.delete(r.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filteredRecords.forEach((r) => next.add(r.id));
      setSelectedIds(next);
    }
  };

  const toggleSelectRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExportExcel = async () => {
    if (recordsToExport.length === 0) {
      showToast('warning', 'No records available to export.');
      return;
    }
    await exportToExcel(recordsToExport);
    showToast(
      'success',
      `Exported ${recordsToExport.length} record(s) to Excel (.xlsx) with Customer Repeat & Date Analysis sheets!`
    );
  };

  const handleExportJson = async () => {
    if (recordsToExport.length === 0) {
      showToast('warning', 'No records available to export.');
      return;
    }
    await exportToJson(recordsToExport);
    showToast('success', `Exported ${recordsToExport.length} record(s) & analytics to JSON!`);
  };

  const jumpToCustomerReceipts = (customerName) => {
    setSearchQuery(customerName);
    setStatusFilter('all');
    setActiveTab('table');
  };

  const jumpToDateReceipts = (dateStr) => {
    if (dateStr === 'Unscheduled / No Date') return;
    setSearchQuery(dateStr);
    setStatusFilter('all');
    setActiveTab('table');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-200">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold tracking-tight text-slate-900">
                  Receipt Data Extractor
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  PDF + OCR + Analytics
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Extract receipts, monitor customer payment dates &amp; repeat customers, and export to Excel/JSON
              </p>
            </div>
          </div>

          {/* Quick Demo & Utility Actions */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => handleLoadSamples(false)}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition disabled:opacity-50 cursor-pointer"
              title="Generate and extract 6 sample PDF receipts including repeat customers"
            >
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Load Sample PDFs</span>
            </button>

            <button
              type="button"
              onClick={() => handleLoadSamples(true)}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 transition disabled:opacity-50 cursor-pointer"
              title="Generate a scanned image-only PDF to test Tesseract OCR fallback"
            >
              <ScanLine className="w-4 h-4 text-amber-600" />
              <span className="hidden md:inline">Test Scanned OCR</span>
              <span className="md:hidden">OCR Demo</span>
            </button>

            {records.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition cursor-pointer"
                title="Clear all extracted records"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Notification Banner */}
        {notification && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-xs transition-all ${
              notification.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : notification.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {notification.type === 'error' ? (
                <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
              ) : notification.type === 'warning' ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              )}
              <span>{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* KPI Summary Dashboard */}
        <section aria-label="Dashboard Summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Receipts Processed */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Receipts Processed
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{stats.totalReceipts}</p>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                <span>{analytics.totalCustomers} Unique Customers</span>
                <span>•</span>
                <span className="text-indigo-600 font-medium">
                  {analytics.repeatCustomersCount} Repeat
                </span>
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
          </div>

          {/* Card 2: Aggregate Total Amount */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Aggregate Amount
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                $
                {stats.aggregateAmount.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Repeat revenue:{' '}
                <strong className="text-emerald-600">
                  $
                  {analytics.repeatRevenue.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>

          {/* Card 3: Processing Status / Success Rate */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Extraction Success Rate
              </p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-2xl font-bold text-slate-900">{stats.successRate}%</p>
                <span className="text-xs font-medium text-emerald-600">
                  ({stats.successCount}/{stats.totalReceipts} complete)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {stats.partialCount + stats.errorCount > 0 ? (
                  <span className="text-amber-600 font-medium">
                    {stats.partialCount + stats.errorCount} item(s) need quick review
                  </span>
                ) : (
                  <span>All core fields verified</span>
                )}
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          {/* Card 4: Export Ready */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Export + Analysis ({selectedIds.size > 0 ? `${selectedIds.size} Selected` : 'All'})
              </p>
              <Download className="w-4 h-4 text-slate-400" />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={recordsToExport.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-40 cursor-pointer shadow-xs"
                title="Exports 3 sheets: Extracted Receipts, Customer Repeat Analysis, and Payment Date Monitor"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                disabled={recordsToExport.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-white hover:bg-slate-900 transition disabled:opacity-40 cursor-pointer shadow-xs"
              >
                <FileJson className="w-4 h-4" />
                <span>JSON (.json)</span>
              </button>
            </div>
          </div>
        </section>

        {/* Drag and Drop PDF & Excel Upload Zone */}
        <section aria-label="PDF and Excel Upload Area">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFilesUpload(e.dataTransfer.files);
              }
            }}
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            className={`relative rounded-2xl border-2 border-dashed p-5 sm:p-7 text-center transition-all cursor-pointer ${
              isDragging
                ? 'border-indigo-600 bg-indigo-50/70 scale-[1.005]'
                : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              onChange={(e) => handleFilesUpload(e.target.files)}
              className="hidden"
            />

            {isProcessing ? (
              <div className="max-w-md mx-auto py-2 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto animate-pulse">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">{progress.stage}</p>
                  <p className="text-xs text-slate-500">
                    Running layout heuristics, OCR fallback &amp; customer payment analysis...
                  </p>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(10, progress.percent)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-4xl mx-auto">
                <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-slate-900">
                      Drag &amp; drop PDF receipts or Excel (`.xlsx`) files here, or{' '}
                      <span className="text-indigo-600 underline decoration-indigo-300 underline-offset-2">
                        browse files
                      </span>
                    </p>
                    <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                      Upload single/multiple PDFs (Native + OCR) or raw Excel data to analyze repeating customers &amp; payment dates
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs sm:text-sm font-semibold shadow-xs hover:bg-indigo-700 transition">
                    Upload PDF / Excel
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Workspace View Switcher: Extracted Data Table vs. Customer & Date Analysis */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="inline-flex items-center gap-1.5 bg-slate-200/70 p-1 rounded-xl self-start">
            <button
              type="button"
              onClick={() => setActiveTab('table')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
                activeTab === 'table'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Receipt className="w-4 h-4 text-indigo-600" />
              <span>Extracted Receipts Table</span>
              <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">
                {records.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('analysis')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
                activeTab === 'analysis'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <span>Customer &amp; Payment Date Analysis</span>
              {analytics.repeatCustomersCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                  {analytics.repeatCustomersCount} Repeat
                </span>
              )}
            </button>
          </div>

          <p className="text-xs text-slate-500">
            Excel export automatically includes <strong>Customer Repeat Analysis</strong> &amp;{' '}
            <strong>Payment Date Monitor</strong> worksheets.
          </p>
        </div>

        {/* TAB 1: EXTRACTED RECEIPTS TABLE */}
        {activeTab === 'table' && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Table Toolbar */}
            <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
                {/* Search Box */}
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search customer, merchant, date, amount, or file..."
                    className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Status Filter Pills */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl self-start">
                  {[
                    { key: 'all', label: `All (${records.length})` },
                    { key: 'success', label: `Complete (${stats.successCount})` },
                    { key: 'partial', label: `Review (${stats.partialCount})` },
                    { key: 'error', label: `Error (${stats.errorCount})` },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setStatusFilter(tab.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                        statusFilter === tab.key
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Right Table Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Selected ({selectedIds.size})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleAddManualRow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Manual Row</span>
                </button>
              </div>
            </div>

            {/* Empty State */}
            {records.length === 0 ? (
              <div className="p-12 text-center max-w-lg mx-auto space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                  <Receipt className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900">
                    No receipts uploaded yet
                  </h2>
                  <p className="text-sm text-slate-500">
                    Drag and drop your PDF receipts or Excel raw data above, or click below to load 6 sample PDFs with repeating customers across multiple dates.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleLoadSamples(false)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs transition cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Load 6 Sample PDFs (with Repeat Customers)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadSamples(true)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 transition cursor-pointer"
                  >
                    <ScanLine className="w-4 h-4 text-amber-600" />
                    <span>Try Scanned OCR Receipt</span>
                  </button>
                </div>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="p-10 text-center text-slate-500 space-y-2">
                <Filter className="w-6 h-6 mx-auto text-slate-400" />
                <p className="text-sm font-medium">
                  No receipts match your current filter or search query.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                  }}
                  className="text-xs font-semibold text-indigo-600 hover:underline"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <>
                {/* Inline Edit Hint Bar */}
                <div className="bg-slate-50/80 px-4 sm:px-6 py-2 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
                    <span>
                      <strong>Tip:</strong> Click any Customer/Merchant Name, Date, or Total Amount cell below to edit inline.
                    </span>
                  </span>
                  <span>
                    Showing <strong>{filteredRecords.length}</strong> of{' '}
                    <strong>{records.length}</strong> receipt(s)
                  </span>
                </div>

                {/* Desktop / Tablet Data Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="py-3 pl-4 sm:pl-6 pr-2 w-10">
                          <input
                            type="checkbox"
                            checked={
                              filteredRecords.length > 0 &&
                              filteredRecords.every((r) => selectedIds.has(r.id))
                            }
                            onChange={toggleSelectAll}
                            aria-label="Select all receipts"
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </th>
                        <th className="py-3 px-3">Source File</th>
                        <th className="py-3 px-3 min-w-[230px]">Customer / Merchant Name</th>
                        <th className="py-3 px-3 min-w-[155px]">Date</th>
                        <th className="py-3 px-3 min-w-[175px]">Total Amount</th>
                        <th className="py-3 px-3">Parser / Status</th>
                        <th className="py-3 pl-3 pr-4 sm:pr-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {filteredRecords.map((rec) => {
                        const isSelected = selectedIds.has(rec.id);
                        const isEditingMerchant =
                          editingCell?.id === rec.id && editingCell?.field === 'merchant_name';
                        const isEditingDate =
                          editingCell?.id === rec.id && editingCell?.field === 'date';
                        const isEditingAmount =
                          editingCell?.id === rec.id && editingCell?.field === 'total_amount';

                        // Check if this customer is a repeat customer
                        const normKey = (rec.merchant_name || '')
                          .trim()
                          .toLowerCase()
                          .replace(/\s+/g, ' ');
                        const custInfo = analytics.customers.find((c) => c.key === normKey);
                        const isRepeatCustomer = custInfo?.isRepeat;

                        return (
                          <tr
                            key={rec.id}
                            className={`group transition-colors ${
                              isSelected ? 'bg-indigo-50/40' : 'hover:bg-slate-50/80'
                            }`}
                          >
                            {/* Checkbox */}
                            <td className="py-3.5 pl-4 sm:pl-6 pr-2 align-middle">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectRow(rec.id)}
                                aria-label={`Select ${rec.filename}`}
                                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                            </td>

                            {/* File Name & Invoice # */}
                            <td className="py-3.5 px-3 align-middle max-w-[190px]">
                              <div className="flex items-start gap-2">
                                <FileText className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                <div className="truncate">
                                  <p
                                    className="font-medium text-slate-800 truncate text-xs sm:text-sm"
                                    title={rec.filename}
                                  >
                                    {rec.filename}
                                  </p>
                                  {rec.invoice_number && (
                                    <p className="text-[11px] text-slate-400 font-mono">
                                      #{rec.invoice_number}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Editable Customer / Merchant Name */}
                            <td className="py-3.5 px-3 align-middle">
                              {isEditingMerchant ? (
                                <div className="space-y-1.5">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={rec.merchant_name}
                                    onChange={(e) =>
                                      handleUpdateRecord(rec.id, 'merchant_name', e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === 'Escape') {
                                        setEditingCell(null);
                                      }
                                    }}
                                    placeholder="Customer / Merchant Name"
                                    className="w-full px-2.5 py-1.5 text-sm font-medium rounded-lg border border-indigo-500 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                  />
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={rec.customer_name || ''}
                                      onChange={(e) =>
                                        handleUpdateRecord(rec.id, 'customer_name', e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === 'Escape') {
                                          setEditingCell(null);
                                        }
                                      }}
                                      placeholder="Billed To / Notes (optional)"
                                      className="w-full px-2 py-1 text-xs rounded-md border border-slate-300 bg-slate-50 focus:outline-none focus:border-indigo-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setEditingCell(null)}
                                      className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0"
                                      title="Done editing"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  onClick={() =>
                                    setEditingCell({ id: rec.id, field: 'merchant_name' })
                                  }
                                  className="group/cell cursor-pointer rounded-lg px-2.5 py-1.5 -mx-2.5 hover:bg-white hover:ring-1 hover:ring-slate-200 transition flex items-center justify-between gap-2"
                                >
                                  <div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                      <span
                                        className={`font-semibold ${
                                          !rec.merchant_name ||
                                          rec.merchant_name === 'Unknown Merchant'
                                            ? 'text-amber-600 italic'
                                            : 'text-slate-900'
                                        }`}
                                      >
                                        {rec.merchant_name || 'Click to enter customer'}
                                      </span>
                                      {isRepeatCustomer && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                          <Repeat className="w-2.5 h-2.5" />
                                          {custInfo.paymentCount}x Repeat
                                        </span>
                                      )}
                                    </div>
                                    {rec.customer_name &&
                                      rec.customer_name !== rec.merchant_name && (
                                        <p className="text-xs text-slate-500 pl-5">
                                          Billed To: {rec.customer_name}
                                        </p>
                                      )}
                                  </div>
                                  <Edit3 className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover/cell:opacity-100 transition shrink-0" />
                                </div>
                              )}
                            </td>

                            {/* Editable Date */}
                            <td className="py-3.5 px-3 align-middle">
                              {isEditingDate ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={rec.date}
                                    onChange={(e) =>
                                      handleUpdateRecord(rec.id, 'date', e.target.value)
                                    }
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === 'Escape') {
                                        setEditingCell(null);
                                      }
                                    }}
                                    placeholder="YYYY-MM-DD"
                                    className="w-32 px-2.5 py-1.5 text-sm font-mono rounded-lg border border-indigo-500 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                  />
                                </div>
                              ) : (
                                <div
                                  onClick={() => setEditingCell({ id: rec.id, field: 'date' })}
                                  className="group/cell cursor-pointer rounded-lg px-2.5 py-1.5 -mx-2.5 hover:bg-white hover:ring-1 hover:ring-slate-200 transition inline-flex flex-col"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    {rec.date ? (
                                      <span className="font-mono text-xs sm:text-sm font-medium text-slate-800">
                                        {rec.date}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-amber-600 italic font-medium">
                                        + Set Date
                                      </span>
                                    )}
                                    <Edit3 className="w-3 h-3 text-slate-300 opacity-0 group-hover/cell:opacity-100 transition" />
                                  </div>
                                  {rec.raw_date && rec.raw_date !== rec.date && (
                                    <span className="text-[11px] text-slate-400 pl-5">
                                      Raw: &ldquo;{rec.raw_date}&rdquo;
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Editable Total Amount & Currency */}
                            <td className="py-3.5 px-3 align-middle">
                              {isEditingAmount ? (
                                <div className="flex items-center gap-1.5">
                                  <select
                                    value={rec.currency || 'USD'}
                                    onChange={(e) =>
                                      handleUpdateRecord(rec.id, 'currency', e.target.value)
                                    }
                                    className="px-2 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:outline-none focus:border-indigo-500"
                                  >
                                    {Object.keys(CURRENCY_SYMBOLS).map((curr) => (
                                      <option key={curr} value={curr}>
                                        {curr}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    step="0.01"
                                    autoFocus
                                    value={rec.total_amount ?? ''}
                                    onChange={(e) =>
                                      handleUpdateRecord(rec.id, 'total_amount', e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === 'Escape') {
                                        setEditingCell(null);
                                      }
                                    }}
                                    placeholder="0.00"
                                    className="w-28 px-2.5 py-1.5 text-sm font-mono font-semibold rounded-lg border border-indigo-500 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setEditingCell(null)}
                                    className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div
                                  onClick={() =>
                                    setEditingCell({ id: rec.id, field: 'total_amount' })
                                  }
                                  className="group/cell cursor-pointer rounded-lg px-2.5 py-1.5 -mx-2.5 hover:bg-white hover:ring-1 hover:ring-slate-200 transition inline-flex items-center gap-1.5"
                                >
                                  {rec.total_amount !== null &&
                                  rec.total_amount !== '' &&
                                  !Number.isNaN(Number(rec.total_amount)) ? (
                                    <span className="font-mono font-bold text-slate-900 text-sm">
                                      {CURRENCY_SYMBOLS[rec.currency] || '$'}
                                      {Number(rec.total_amount).toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                      <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                                        {rec.currency || 'USD'}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-xs text-amber-600 italic font-medium">
                                      + Enter Amount
                                    </span>
                                  )}
                                  <Edit3 className="w-3 h-3 text-slate-300 opacity-0 group-hover/cell:opacity-100 transition" />
                                </div>
                              )}
                            </td>

                            {/* Extraction Method & Status */}
                            <td className="py-3.5 px-3 align-middle">
                              <div className="flex flex-col items-start gap-1">
                                {rec.status === 'success' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Verified
                                  </span>
                                ) : rec.status === 'partial' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                    <AlertTriangle className="w-3 h-3" />
                                    Needs Review
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                                    <XCircle className="w-3 h-3" />
                                    Failed
                                  </span>
                                )}
                                <span className="text-[11px] text-slate-400">
                                  {rec.extraction_method || 'Native PDF'}
                                </span>
                              </div>
                            </td>

                            {/* Row Actions */}
                            <td className="py-3.5 pl-3 pr-4 sm:pr-6 align-middle text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setInspectRecord(rec)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                                  title="Inspect extracted PDF text & verify fields"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span className="hidden xl:inline">Inspect</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRecord(rec.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                  title="Delete receipt record"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* TAB 2: CUSTOMER & PAYMENT DATE ANALYSIS */}
        {activeTab === 'analysis' && (
          <div className="space-y-6">
            {records.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-lg mx-auto space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                  <BarChart3 className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900">
                    No customer payment data to analyze yet
                  </h2>
                  <p className="text-sm text-slate-500">
                    Upload your PDF receipts or Excel raw data, or load our 6 sample receipts to immediately see repeating customers and payment date timelines.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleLoadSamples(false)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs transition cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Load 6 Sample PDFs to Preview Analysis</span>
                </button>
              </div>
            ) : (
              <>
                {/* Analytics Insights KPI Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Insight 1: Repeat Customers */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Repeating Customers
                      </span>
                      <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                        <Repeat className="w-4 h-4" />
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-slate-900">
                        {analytics.repeatCustomersCount}
                      </span>
                      <span className="text-xs font-medium text-indigo-600">
                        of {analytics.totalCustomers} customers ({analytics.repeatRate}%)
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {analytics.oneTimeCustomersCount} one-time customer(s)
                    </p>
                  </div>

                  {/* Insight 2: Repeat Customer Revenue */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Repeat Customer Revenue
                      </span>
                      <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                        <TrendingUp className="w-4 h-4" />
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-slate-900 mt-2">
                      $
                      {analytics.repeatRevenue.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {analytics.totalRevenue > 0
                        ? `${Math.round((analytics.repeatRevenue / analytics.totalRevenue) * 100)}% of total collected revenue`
                        : '0% of total revenue'}
                    </p>
                  </div>

                  {/* Insight 3: Top Paying Customer */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Top Paying Customer
                      </span>
                      <span className="p-2 rounded-lg bg-amber-50 text-amber-600">
                        <Users className="w-4 h-4" />
                      </span>
                    </div>
                    <p
                      className="text-base font-bold text-slate-900 mt-2 truncate"
                      title={analytics.topCustomer?.name || 'N/A'}
                    >
                      {analytics.topCustomer?.name || 'N/A'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {analytics.topCustomer ? (
                        <>
                          <strong className="text-slate-800">
                            ${analytics.topCustomer.totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </strong>{' '}
                          across {analytics.topCustomer.paymentCount} payment(s)
                        </>
                      ) : (
                        'No data'
                      )}
                    </p>
                  </div>

                  {/* Insight 4: Peak Payment Date */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Peak Payment Date
                      </span>
                      <span className="p-2 rounded-lg bg-purple-50 text-purple-600">
                        <Calendar className="w-4 h-4" />
                      </span>
                    </div>
                    <p className="text-xl font-bold font-mono text-slate-900 mt-2">
                      {analytics.peakDate?.date || 'N/A'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {analytics.peakDate ? (
                        <>
                          <strong className="text-slate-800">
                            ${analytics.peakDate.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </strong>{' '}
                          ({analytics.peakDate.receiptCount} payment
                          {analytics.peakDate.receiptCount === 1 ? '' : 's'})
                        </>
                      ) : (
                        'No dates recorded'
                      )}
                    </p>
                  </div>
                </div>

                {/* Section A: Repeating Customer & Loyalty Monitor */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                        <Repeat className="w-4 h-4 text-indigo-600" />
                        <span>Customer Repeat &amp; Loyalty Analysis</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Identify repeating customers, how many times they paid, and all dates they paid your service
                      </p>
                    </div>

                    {/* Customer Filter Pills */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl self-start">
                      {[
                        { key: 'all', label: `All Customers (${analytics.totalCustomers})` },
                        {
                          key: 'repeat',
                          label: `Repeating (${analytics.repeatCustomersCount})`,
                        },
                        {
                          key: 'onetime',
                          label: `One-Time (${analytics.oneTimeCustomersCount})`,
                        },
                      ].map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setCustomerFilter(f.key)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                            customerFilter === f.key
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          <th className="py-3 pl-4 sm:pl-6 pr-3">Customer / Merchant</th>
                          <th className="py-3 px-3">Customer Status</th>
                          <th className="py-3 px-3">Payment Dates (When They Paid)</th>
                          <th className="py-3 px-3">Total Paid</th>
                          <th className="py-3 px-3">Avg Payment</th>
                          <th className="py-3 px-3 min-w-[140px]">Revenue Share</th>
                          <th className="py-3 pl-3 pr-4 sm:pr-6 text-right">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-sm">
                        {filteredCustomers.map((cust) => (
                          <tr key={cust.key} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3.5 pl-4 sm:pl-6 pr-3 font-semibold text-slate-900">
                              <div className="flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                                <span>{cust.name}</span>
                              </div>
                            </td>

                            <td className="py-3.5 px-3">
                              {cust.isRepeat ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  <Repeat className="w-3 h-3" />
                                  Repeat Customer ({cust.paymentCount}x)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                                  One-Time (1x)
                                </span>
                              )}
                            </td>

                            <td className="py-3.5 px-3">
                              <div className="flex flex-wrap gap-1.5">
                                {cust.sortedDates.length > 0 ? (
                                  cust.sortedDates.map((d, idx) => (
                                    <button
                                      key={`${cust.key}-d-${idx}`}
                                      type="button"
                                      onClick={() => jumpToDateReceipts(d)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 border border-slate-200 transition cursor-pointer"
                                      title={`Filter receipts on ${d}`}
                                    >
                                      <Calendar className="w-3 h-3 text-slate-400" />
                                      {d}
                                    </button>
                                  ))
                                ) : (
                                  <span className="text-xs text-slate-400 italic">No date</span>
                                )}
                              </div>
                              {cust.sortedDates.length >= 2 && (
                                <p className="text-[11px] text-slate-400 mt-1">
                                  First: {cust.firstPaymentDate} • Latest: {cust.lastPaymentDate}
                                </p>
                              )}
                            </td>

                            <td className="py-3.5 px-3 font-mono font-bold text-slate-900">
                              $
                              {cust.totalPaid.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>

                            <td className="py-3.5 px-3 font-mono text-slate-600 text-xs sm:text-sm">
                              $
                              {cust.avgPayment.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>

                            <td className="py-3.5 px-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-indigo-600 rounded-full"
                                    style={{ width: `${Math.min(100, cust.revenueShare)}%` }}
                                  />
                                </div>
                                <span className="text-xs font-mono font-medium text-slate-600 w-11 text-right">
                                  {cust.revenueShare}%
                                </span>
                              </div>
                            </td>

                            <td className="py-3.5 pl-3 pr-4 sm:pr-6 text-right">
                              <button
                                type="button"
                                onClick={() => jumpToCustomerReceipts(cust.name)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                              >
                                <span>Receipts</span>
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Section B: Payment Date Monitor (Which Date Customers Paid) */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-emerald-600" />
                        <span>Payment Date Monitor (Chronological Timeline)</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Monitor every date a payment was received, which customers paid on that date, and daily totals
                      </p>
                    </div>
                    <span className="text-xs font-medium text-slate-500">
                      {analytics.timeline.length} Active Payment Date(s)
                    </span>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {analytics.timeline.map((day) => {
                      const barPercent =
                        analytics.maxDateAmount > 0
                          ? Math.max(6, Math.round((day.totalCollected / analytics.maxDateAmount) * 100))
                          : 0;

                      return (
                        <div
                          key={day.date}
                          className="p-4 sm:px-6 hover:bg-slate-50/70 transition flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                        >
                          {/* Date & Payment Count */}
                          <div className="flex items-start sm:items-center gap-3 min-w-[210px]">
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0 font-mono text-xs font-bold">
                              <Calendar className="w-4 h-4" />
                            </div>
                            <div>
                              <button
                                type="button"
                                onClick={() => jumpToDateReceipts(day.date)}
                                className="font-mono text-sm font-bold text-slate-900 hover:text-indigo-600 transition cursor-pointer"
                              >
                                {day.date}
                              </button>
                              <p className="text-xs text-slate-500">
                                {day.receiptCount} payment{day.receiptCount === 1 ? '' : 's'} received
                              </p>
                            </div>
                          </div>

                          {/* Customers Who Paid on This Date */}
                          <div className="flex-1">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                              Customers Who Paid on {day.date}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {day.customers.map((c, idx) => (
                                <button
                                  key={`${day.date}-cust-${idx}`}
                                  type="button"
                                  onClick={() => jumpToCustomerReceipts(c.name)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-indigo-50 text-slate-800 hover:text-indigo-700 border border-slate-200 transition cursor-pointer"
                                >
                                  <span className="font-semibold">{c.name}</span>
                                  <span className="font-mono text-emerald-700 font-bold">
                                    ${c.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Date Total & Visual Bar */}
                          <div className="lg:w-64 flex flex-col lg:items-end justify-center shrink-0">
                            <div className="flex items-baseline justify-between lg:justify-end gap-2 w-full">
                              <span className="text-xs text-slate-400 lg:hidden">Date Total:</span>
                              <span className="font-mono text-base font-bold text-slate-900">
                                $
                                {day.totalCollected.toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-1.5">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${barPercent}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </main>

      {/* Receipt Raw Text & Field Inspector Modal */}
      {inspectRecord && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setInspectRecord(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {inspectRecord.filename}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Extraction Method: <strong>{inspectRecord.extraction_method}</strong> • Confidence:{' '}
                    <strong>{inspectRecord.confidence ?? 100}%</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectRecord(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Side-by-side Editable Fields & Raw Extracted Text */}
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Editable Extracted Fields */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Extracted Receipt Fields (Editable)
                </h4>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Customer / Merchant Name
                  </label>
                  <input
                    type="text"
                    value={inspectRecord.merchant_name || ''}
                    onChange={(e) =>
                      handleUpdateRecord(inspectRecord.id, 'merchant_name', e.target.value)
                    }
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Customer / Billed To
                    </label>
                    <input
                      type="text"
                      value={inspectRecord.customer_name || ''}
                      onChange={(e) =>
                        handleUpdateRecord(inspectRecord.id, 'customer_name', e.target.value)
                      }
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Invoice / Receipt #
                    </label>
                    <input
                      type="text"
                      value={inspectRecord.invoice_number || ''}
                      onChange={(e) =>
                        handleUpdateRecord(inspectRecord.id, 'invoice_number', e.target.value)
                      }
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Receipt / Invoice Date
                  </label>
                  <input
                    type="text"
                    value={inspectRecord.date || ''}
                    onChange={(e) =>
                      handleUpdateRecord(inspectRecord.id, 'date', e.target.value)
                    }
                    placeholder="YYYY-MM-DD"
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Currency
                    </label>
                    <select
                      value={inspectRecord.currency || 'USD'}
                      onChange={(e) =>
                        handleUpdateRecord(inspectRecord.id, 'currency', e.target.value)
                      }
                      className="w-full px-3 py-2 text-sm font-semibold rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-indigo-500"
                    >
                      {Object.keys(CURRENCY_SYMBOLS).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Total Amount
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={inspectRecord.total_amount ?? ''}
                      onChange={(e) =>
                        handleUpdateRecord(inspectRecord.id, 'total_amount', e.target.value)
                      }
                      className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Raw Extracted PDF / OCR Text */}
              <div className="flex flex-col h-full">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Extracted Raw Document Text
                </h4>
                <pre className="flex-1 p-3.5 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono leading-relaxed overflow-auto max-h-72 whitespace-pre-wrap">
                  {inspectRecord.raw_text || 'No raw text available for this file.'}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Changes are saved automatically to your table &amp; analytics.
              </span>
              <button
                type="button"
                onClick={() => setInspectRecord(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition cursor-pointer"
              >
                Done Reviewing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-4 sm:px-6 lg:px-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            <strong>Receipt Data Extractor</strong> • Automated PDF/OCR Extraction + Customer Repeat &amp; Payment Date Analytics
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                backendConnected ? 'bg-emerald-500' : 'bg-indigo-500'
              }`}
            />
            {backendConnected
              ? 'Connected to FastAPI Backend (Port 8000)'
              : 'Active Engine: Smart Browser PDF + OCR + Analytics'}
          </span>
        </div>
      </footer>
    </div>
  );
}
