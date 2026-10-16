import io
import re
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Optional imports with graceful degradation
try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

try:
    from pypdf import PdfReader
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

try:
    from pdf2image import convert_from_bytes
    HAS_PDF2IMAGE = True
except ImportError:
    HAS_PDF2IMAGE = False

try:
    import pytesseract
    from PIL import Image
    HAS_PYTESSERACT = True
except ImportError:
    HAS_PYTESSERACT = False


CURRENCY_MAP = {
    "$": "USD",
    "US$": "USD",
    "USD": "USD",
    "€": "EUR",
    "EUR": "EUR",
    "£": "GBP",
    "GBP": "GBP",
    "¥": "JPY",
    "JPY": "JPY",
    "CAD": "CAD",
    "C$": "CAD",
    "AUD": "AUD",
    "A$": "AUD",
    "CHF": "CHF",
    "AED": "AED",
    "SAR": "SAR",
    "INR": "INR",
    "₹": "INR",
    "RM": "MYR",
    "MYR": "MYR",
    "SGD": "SGD",
    "S$": "SGD",
}

MONTH_NAMES = (
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
)

IGNORE_MERCHANT_KEYWORDS = [
    r"^invoice\b",
    r"^receipt\b",
    r"^tax\s+invoice\b",
    r"^cash\s+receipt\b",
    r"^sales\s+receipt\b",
    r"^payment\s+receipt\b",
    r"^billing\s+statement\b",
    r"^order\s+confirmation\b",
    r"^statement\b",
    r"^page\s+\d+",
    r"^date\s*[:\-]",
    r"^time\s*[:\-]",
    r"^tel\s*[:\-]",
    r"^phone\s*[:\-]",
    r"^fax\s*[:\-]",
    r"^www\.",
    r"^http",
    r"^\d+\s*$",
    r"^original\b",
    r"^duplicate\b",
    r"^thank\s+you",
]


class ReceiptExtractor:
    """
    Extracts structured fields (Merchant/Customer Name, Date, Total Amount, Currency)
    from native text PDFs and scanned image-based PDFs using OCR fallback.
    """

    @staticmethod
    def extract_text_from_pdf(file_bytes: bytes) -> Tuple[str, str, int]:
        """
        Attempts to extract text from a PDF using native parsers (pdfplumber -> pypdf -> PyMuPDF),
        and falls back to OCR (pdf2image / PyMuPDF + pytesseract) if the PDF is scanned or empty.

        Returns:
            Tuple[extracted_text, extraction_method, page_count]
        """
        extracted_text = ""
        method = "native"
        page_count = 0

        # 1. Try pdfplumber first (excellent layout preservation for tables & invoices)
        if HAS_PDFPLUMBER:
            try:
                with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                    page_count = len(pdf.pages)
                    pages_text = []
                    for page in pdf.pages:
                        txt = page.extract_text(layout=False) or ""
                        pages_text.append(txt)
                    extracted_text = "\n".join(pages_text).strip()
                    if len(extracted_text) >= 20:
                        return extracted_text, "pdfplumber (Native)", page_count
            except Exception as e:
                logger.warning(f"pdfplumber extraction failed: {e}")

        # 2. Fallback to pypdf for native text
        if HAS_PYPDF and len(extracted_text) < 20:
            try:
                reader = PdfReader(io.BytesIO(file_bytes))
                page_count = len(reader.pages)
                pages_text = [page.extract_text() or "" for page in reader.pages]
                extracted_text = "\n".join(pages_text).strip()
                if len(extracted_text) >= 20:
                    return extracted_text, "pypdf (Native)", page_count
            except Exception as e:
                logger.warning(f"pypdf extraction failed: {e}")

        # 3. Fallback to PyMuPDF native text
        if HAS_PYMUPDF and len(extracted_text) < 20:
            try:
                doc = fitz.open(stream=file_bytes, filetype="pdf")
                page_count = len(doc)
                pages_text = [page.get_text("text") or "" for page in doc]
                doc.close()
                extracted_text = "\n".join(pages_text).strip()
                if len(extracted_text) >= 20:
                    return extracted_text, "PyMuPDF (Native)", page_count
            except Exception as e:
                logger.warning(f"PyMuPDF native extraction failed: {e}")

        # 4. OCR Fallback for scanned / image-based PDFs
        ocr_text = ReceiptExtractor._perform_ocr(file_bytes)
        if ocr_text and len(ocr_text.strip()) > len(extracted_text):
            return ocr_text.strip(), "OCR (pytesseract)", max(page_count, 1)

        return extracted_text, method, max(page_count, 1)

    @staticmethod
    def _perform_ocr(file_bytes: bytes) -> str:
        """
        Converts PDF pages to images via pdf2image (or PyMuPDF fallback) and runs pytesseract OCR.
        """
        if not HAS_PYTESSERACT:
            logger.warning("pytesseract is not installed; skipping OCR fallback.")
            return ""

        images = []
        # Try pdf2image first
        if HAS_PDF2IMAGE:
            try:
                images = convert_from_bytes(file_bytes, dpi=250)
            except Exception as e:
                logger.warning(f"pdf2image failed (Poppler may be missing): {e}")

        # Fallback to PyMuPDF image rendering if pdf2image failed
        if not images and HAS_PYMUPDF:
            try:
                doc = fitz.open(stream=file_bytes, filetype="pdf")
                for page in doc:
                    pix = page.get_pixmap(dpi=250)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    images.append(img)
                doc.close()
            except Exception as e:
                logger.warning(f"PyMuPDF image rendering failed: {e}")

        if not images:
            return ""

        ocr_pages = []
        for img in images:
            try:
                text = pytesseract.image_to_string(img, config="--oem 3 --psm 6")
                ocr_pages.append(text)
            except Exception as e:
                logger.warning(f"pytesseract OCR failed on page: {e}")

        return "\n".join(ocr_pages)

    @classmethod
    def parse_receipt_text(cls, text: str, filename: str = "") -> Dict[str, Any]:
        """
        Runs smart regex & heuristic extraction on receipt/invoice text to extract:
        - merchant_name (Customer / Merchant Name)
        - customer_name (Billed To / Customer if explicitly present)
        - date (Normalized YYYY-MM-DD when possible, or clean string)
        - raw_date (Original matched date string)
        - total_amount (Float numeric value)
        - currency (Detected currency code e.g. USD, EUR, GBP)
        - invoice_number (Bonus useful metadata)
        - confidence (0-100 score based on field completeness)
        """
        lines = [line.strip() for line in text.splitlines() if line.strip()]

        merchant_name, customer_name = cls._extract_merchant_and_customer(lines, text, filename)
        normalized_date, raw_date = cls._extract_date(text, lines)
        total_amount, currency = cls._extract_total_amount(text, lines)
        invoice_number = cls._extract_invoice_number(text)

        # Calculate extraction confidence
        found_fields = 0
        if merchant_name and merchant_name != "Unknown Merchant":
            found_fields += 1
        if normalized_date:
            found_fields += 1
        if total_amount is not None:
            found_fields += 1

        confidence = round((found_fields / 3.0) * 100)
        status = "success" if found_fields == 3 else ("partial" if found_fields > 0 else "error")

        display_entity = merchant_name
        if customer_name and merchant_name != "Unknown Merchant":
            display_entity = f"{merchant_name} (Customer: {customer_name})"
        elif customer_name:
            display_entity = customer_name

        return {
            "merchant_name": merchant_name or "Unknown Merchant",
            "customer_name": customer_name or "",
            "display_entity": display_entity or "Unknown Merchant",
            "date": normalized_date or "",
            "raw_date": raw_date or "",
            "total_amount": total_amount,
            "currency": currency or "USD",
            "invoice_number": invoice_number or "",
            "confidence": confidence,
            "status": status,
        }

    @classmethod
    def _extract_merchant_and_customer(
        cls, lines: List[str], full_text: str, filename: str
    ) -> Tuple[str, str]:
        """
        Extracts both the Merchant/Vendor name and optional Customer ('Billed To') name.
        """
        merchant = ""
        customer = ""

        # 1. Explicit Merchant / Vendor labels
        merchant_patterns = [
            r"(?:Merchant|Vendor|Store(?:\s+Name)?|From|Seller|Sold\s+By|Company|Issued\s+By)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\s&\.,'\-\(\)]{2,60})",
        ]
        for pat in merchant_patterns:
            m = re.search(pat, full_text, re.IGNORECASE)
            if m:
                candidate = cls._clean_entity_name(m.group(1).splitlines()[0])
                if candidate:
                    merchant = candidate
                    break

        # 2. Explicit Customer / Billed To labels
        customer_patterns = [
            r"(?:Bill(?:ed)?\s+To|Customer(?:\s+Name)?|Client(?:\s+Name)?|Sold\s+To|Ship\s+To|Prepared\s+For)\s*[:\-]?\s*\n?\s*([A-Za-z0-9][A-Za-z0-9\s&\.,'\-\(\)]{2,60})",
        ]
        for pat in customer_patterns:
            m = re.search(pat, full_text, re.IGNORECASE)
            if m:
                candidate = cls._clean_entity_name(m.group(1).splitlines()[0])
                if candidate and not re.match(r"^(?:date|invoice|receipt|address|phone|email)\b", candidate, re.I):
                    customer = candidate
                    break

        # 3. Heuristic header scan for Merchant Name (top lines of receipt/invoice)
        if not merchant:
            for line in lines[:10]:
                cleaned = cls._clean_entity_name(line)
                if not cleaned or len(cleaned) < 2:
                    continue
                # Skip generic document headers, dates, addresses, or phone numbers
                if any(re.search(pat, cleaned, re.IGNORECASE) for pat in IGNORE_MERCHANT_KEYWORDS):
                    continue
                # Skip lines that are mostly digits/symbols (like phone numbers, zip codes, dates)
                alpha_count = sum(1 for c in cleaned if c.isalpha())
                if alpha_count < 3 or alpha_count / max(len(cleaned), 1) < 0.4:
                    continue
                # Skip street address lines (e.g., "123 Main St")
                if re.match(r"^\d+\s+[A-Za-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Way)\b", cleaned, re.I):
                    continue

                merchant = cleaned
                break

        # 4. Fallback to customer if merchant wasn't found, or filename cleanup
        if not merchant and customer:
            merchant = customer
            customer = ""

        if not merchant and filename:
            base = re.sub(r"\.pdf$", "", filename, flags=re.IGNORECASE)
            base = re.sub(r"[_\-]+", " ", base).strip()
            if base:
                merchant = base.title()

        return merchant or "Unknown Merchant", customer

    @staticmethod
    def _clean_entity_name(raw: str) -> str:
        """Cleans trailing metadata like 'Invoice #123' or 'Date: ...' from a single line."""
        # Split off common right-aligned columns on the same line
        cleaned = re.split(
            r"\s{2,}(?:Invoice|Receipt|Date|Order|Bill|Tax|Tel|Phone|No\.|#)\b",
            raw,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" :-|*,._")
        return cleaned[:65]

    @classmethod
    def _extract_date(cls, full_text: str, lines: List[str]) -> Tuple[str, str]:
        """
        Extracts and normalizes dates across multiple formats:
        - YYYY-MM-DD or YYYY/MM/DD
        - DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY
        - MMM DD, YYYY (e.g., Oct 16, 2026 / October 16, 2026)
        - DD MMM YYYY (e.g., 16 Oct 2026 / 16-Oct-2026)
        Prioritizes lines labeled with 'Date', 'Invoice Date', 'Transaction Date', 'Issued'.
        """
        date_regexes = [
            # ISO format: YYYY-MM-DD or YYYY/MM/DD
            r"\b(20\d{2}|19\d{2})[\-/\.](0?[1-9]|1[0-2])[\-/\.](0?[1-9]|[12]\d|3[01])\b",
            # Month Name DD, YYYY (e.g., Jan 15, 2025 or January 15th, 2025)
            rf"\b({MONTH_NAMES})\.?\s+(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?,?\s+(20\d{{2}}|19\d{{2}})\b",
            # DD Month Name YYYY (e.g., 15 Jan 2025 or 15-Jan-2025 or 15-Jan-25)
            rf"\b(0?[1-9]|[12]\d|3[01])[\s\-/\.]*({MONTH_NAMES})\.?[\s\-/,\.]*(20\d{{2}}|19\d{{2}}|\d{{2}})\b",
            # Slash/Dash numeric: DD/MM/YYYY or MM/DD/YYYY or MM/DD/YY
            r"\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|[12]\d|3[01])[\/\-\.](20\d{2}|19\d{2}|\d{2})\b",
        ]

        # 1. First search specifically near Date labels (avoiding Due Date if Invoice Date exists)
        labeled_Context_patterns = [
            r"(?:Invoice\s+Date|Receipt\s+Date|Transaction\s+Date|Order\s+Date|Date\s+of\s+Issue|Issued\s+Date|Date)\s*[:\-]?\s*([^\n]{5,35})",
        ]
        for lpat in labeled_Context_patterns:
            for match in re.finditer(lpat, full_text, re.IGNORECASE):
                snippet = match.group(1)
                for dr in date_regexes:
                    dm = re.search(dr, snippet, re.IGNORECASE)
                    if dm:
                        raw_str = dm.group(0)
                        norm = cls._normalize_date_string(raw_str)
                        if norm:
                            return norm, raw_str

        # 2. Search across all lines in the document
        for line in lines:
            # Skip due date lines on first pass if possible
            if re.search(r"\b(?:due\s+date|payment\s+due|valid\s+until)\b", line, re.IGNORECASE):
                continue
            for dr in date_regexes:
                dm = re.search(dr, line, re.IGNORECASE)
                if dm:
                    raw_str = dm.group(0)
                    norm = cls._normalize_date_string(raw_str)
                    if norm:
                        return norm, raw_str

        # 3. Last resort: allow Due Date if no other date exists
        for dr in date_regexes:
            dm = re.search(dr, full_text, re.IGNORECASE)
            if dm:
                raw_str = dm.group(0)
                norm = cls._normalize_date_string(raw_str)
                if norm:
                    return norm, raw_str

        return "", ""

    @staticmethod
    def _normalize_date_string(raw_date: str) -> str:
        """
        Attempts to parse a raw date string into ISO YYYY-MM-DD format.
        Returns the original cleaned string if parsing is ambiguous, or empty if invalid.
        """
        cleaned = re.sub(r"(\d)(?:st|nd|rd|th)\b", r"\1", raw_date, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s+", " ", cleaned.replace(",", ", ")).strip()
        cleaned = re.sub(r",\s+", ", ", cleaned)

        formats = [
            "%Y-%m-%d",
            "%Y/%m/%d",
            "%Y.%m.%d",
            "%b %d, %Y",
            "%B %d, %Y",
            "%b %d %Y",
            "%B %d %Y",
            "%b. %d, %Y",
            "%d %b %Y",
            "%d %B %Y",
            "%d-%b-%Y",
            "%d-%B-%Y",
            "%d-%b-%y",
            "%d/%b/%Y",
            "%d %b, %Y",
            "%d %B, %Y",
            "%m/%d/%Y",
            "%d/%m/%Y",
            "%m-%d-%Y",
            "%d-%m-%Y",
            "%d.%m.%Y",
            "%m/%d/%y",
            "%d/%m/%y",
            "%m-%d-%y",
            "%d-%m-%y",
        ]

        for fmt in formats:
            try:
                dt = datetime.strptime(cleaned, fmt)
                if 1990 <= dt.year <= 2040:
                    return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue

        return raw_date.strip()

    @classmethod
    def _extract_total_amount(cls, full_text: str, lines: List[str]) -> Tuple[Optional[float], str]:
        """
        Extracts the final Total Amount and Currency using tiered priority matching:
        Tier 1: High-confidence explicit final total labels ('Grand Total', 'Total Due', 'Amount Due', 'Balance Due', 'Total Paid', 'Net Total', 'Total Amount')
        Tier 2: Standard 'Total' label (excluding 'Sub Total', 'Tax Total', 'Discount Total')
        Tier 3: Bottom-of-receipt currency amount heuristic
        """
        detected_currency = cls._detect_currency(full_text)

        # Regex for numeric amount with optional currency prefix/suffix
        # Supports 1,234.56 or 1234.56 or 1.234,56 (European)
        amount_pattern = (
            r"(?P<curr>US\$|C\$|A\$|S\$|USD|EUR|GBP|CAD|AUD|CHF|AED|SAR|INR|MYR|SGD|JPY|RM|[\$€£¥₹])?\s*"
            r"(?P<num>\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\d+\.\d{2}|\d{1,3}(?:\.\d{3})+,\d{2})"
        )

        # Tier 1: High priority total labels
        tier1_labels = (
            r"(?:Grand\s+Total|Total\s+Amount\s+Due|Amount\s+Due|Balance\s+Due|Total\s+Due|"
            r"Total\s+Paid|Net\s+Total|Invoice\s+Total|Order\s+Total|Total\s+Amount|Amount\s+Paid|"
            r"Total\s+Charged|Total\s+\([A-Z]{3}\))"
        )

        tier1_candidates: List[Tuple[float, str]] = []
        for i, line in enumerate(lines):
            if re.search(tier1_labels, line, re.IGNORECASE):
                # Exclude subtotal lines
                if re.search(r"\b(?:sub[\s\-]?total)\b", line, re.IGNORECASE):
                    continue
                val, curr = cls._extract_amount_from_line_or_next(lines, i, amount_pattern)
                if val is not None:
                    tier1_candidates.append((val, curr or detected_currency))

        if tier1_candidates:
            # Usually the last explicit Total Due / Grand Total on the receipt is the final amount
            return tier1_candidates[-1]

        # Tier 2: Generic 'Total' or 'Payment' label (strictly excluding Subtotal, Tax, Tip, Discount)
        tier2_candidates: List[Tuple[float, str]] = []
        for i, line in enumerate(lines):
            if re.search(r"\bTotal\b", line, re.IGNORECASE):
                if re.search(
                    r"\b(?:sub[\s\-]?total|tax\s+total|total\s+tax|vat\s+total|discount\s+total|total\s+discount|total\s+items|total\s+qty|total\s+quantity|total\s+hours|total\s+savings)\b",
                    line,
                    re.IGNORECASE,
                ):
                    continue
                val, curr = cls._extract_amount_from_line_or_next(lines, i, amount_pattern)
                if val is not None:
                    tier2_candidates.append((val, curr or detected_currency))

        if tier2_candidates:
            # Pick the largest or last total candidate (in receipts, Total >= Subtotal)
            return max(tier2_candidates, key=lambda x: x[0])

        # Tier 3: Fallback — find all decimal currency values in the bottom half of the document and return the max
        fallback_candidates: List[Tuple[float, str]] = []
        start_idx = max(0, len(lines) // 2)
        for line in lines[start_idx:]:
            for m in re.finditer(amount_pattern, line):
                val = cls._parse_number(m.group("num"))
                curr_raw = (m.group("curr") or "").strip()
                curr = CURRENCY_MAP.get(curr_raw.upper(), CURRENCY_MAP.get(curr_raw, detected_currency))
                if val is not None and 0.01 <= val <= 10_000_000:
                    fallback_candidates.append((val, curr))

        if fallback_candidates:
            return max(fallback_candidates, key=lambda x: x[0])

        return None, detected_currency

    @classmethod
    def _extract_amount_from_line_or_next(
        cls, lines: List[str], idx: int, amount_pattern: str
    ) -> Tuple[Optional[float], str]:
        """
        Extracts the last numeric amount on `lines[idx]`, or checks `lines[idx + 1]`
        when a PDF layout splits the label and value across consecutive lines.
        """
        line = lines[idx]
        matches = list(re.finditer(amount_pattern, line))
        if matches:
            last_match = matches[-1]
            val = cls._parse_number(last_match.group("num"))
            curr_raw = (last_match.group("curr") or "").strip()
            curr = CURRENCY_MAP.get(curr_raw.upper(), CURRENCY_MAP.get(curr_raw, ""))
            if val is not None:
                return val, curr

        # Check the very next line if it's just a currency/number
        if idx + 1 < len(lines):
            next_line = lines[idx + 1]
            if len(next_line) < 25:
                matches_next = list(re.finditer(amount_pattern, next_line))
                if matches_next:
                    last_match = matches_next[-1]
                    val = cls._parse_number(last_match.group("num"))
                    curr_raw = (last_match.group("curr") or "").strip()
                    curr = CURRENCY_MAP.get(curr_raw.upper(), CURRENCY_MAP.get(curr_raw, ""))
                    if val is not None:
                        return val, curr

        return None, ""

    @staticmethod
    def _parse_number(num_str: str) -> Optional[float]:
        """Normalizes US (1,234.56) and European (1.234,56) formatted numbers into float."""
        if not num_str:
            return None
        s = num_str.strip().replace(" ", "")
        # Handle European format e.g. 1.234,56
        if "," in s and "." in s:
            if s.rfind(",") > s.rfind("."):
                s = s.replace(".", "").replace(",", ".")
            else:
                s = s.replace(",", "")
        elif "," in s and re.search(r",\d{2}$", s):
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")

        try:
            return round(float(s), 2)
        except ValueError:
            return None

    @staticmethod
    def _detect_currency(text: str) -> str:
        """Detects the primary currency symbol or ISO code in the document."""
        for token, iso in [
            ("USD", "USD"),
            ("EUR", "EUR"),
            ("GBP", "GBP"),
            ("CAD", "CAD"),
            ("AUD", "AUD"),
            ("SGD", "SGD"),
            ("MYR", "MYR"),
            ("AED", "AED"),
            ("SAR", "SAR"),
            ("INR", "INR"),
            ("€", "EUR"),
            ("£", "GBP"),
            ("₹", "INR"),
            ("¥", "JPY"),
            ("$", "USD"),
        ]:
            if token in text:
                return iso
        return "USD"

    @staticmethod
    def _extract_invoice_number(text: str) -> str:
        """Extracts optional Invoice / Receipt number for helpful context."""
        patterns = [
            r"(?:Invoice|Receipt|Order|Transaction)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]{3,25})",
            r"(?:INV|REC)[\-\s#]*(\d{3,15})",
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                val = m.group(1).strip()
                if not re.match(r"^(?:date|total|amount|to|from)$", val, re.I):
                    return val
        return ""
