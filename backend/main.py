import uuid
import logging
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from extractor import ReceiptExtractor
from exporter import generate_excel_bytes, generate_json_string

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("receipt-extractor-api")

app = FastAPI(
    title="Receipt Data Extractor API",
    description="Automated PDF receipt & invoice extraction API with native PDF parsing, OCR fallback, and Excel/JSON export.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ReceiptRecord(BaseModel):
    id: str
    filename: str
    merchant_name: str
    customer_name: Optional[str] = ""
    invoice_number: Optional[str] = ""
    date: str
    raw_date: Optional[str] = ""
    total_amount: Optional[float] = None
    currency: str = "USD"
    extraction_method: Optional[str] = "Native PDF"
    confidence: Optional[int] = 100
    status: str = "success"
    raw_text: Optional[str] = ""
    error_message: Optional[str] = ""


class ExportRequest(BaseModel):
    records: List[Dict[str, Any]]


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "Receipt Data Extractor API",
        "version": "1.0.0",
    }


@app.post("/api/extract")
async def extract_receipts(files: List[UploadFile] = File(...)):
    """
    Processes one or more uploaded PDF receipts/invoices, extracting:
    - Customer / Merchant Name
    - Date (normalized & raw)
    - Total Amount & Currency
    With automatic fallback from native PDF text extraction to OCR.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided for extraction.")

    results = []
    for upload in files:
        record_id = str(uuid.uuid4())
        filename = upload.filename or "unnamed_receipt.pdf"

        if not filename.lower().endswith(".pdf"):
            results.append(
                {
                    "id": record_id,
                    "filename": filename,
                    "merchant_name": "Invalid File Format",
                    "customer_name": "",
                    "invoice_number": "",
                    "date": "",
                    "raw_date": "",
                    "total_amount": None,
                    "currency": "USD",
                    "extraction_method": "N/A",
                    "confidence": 0,
                    "status": "error",
                    "raw_text": "",
                    "error_message": "Only PDF files (.pdf) are supported.",
                }
            )
            continue

        try:
            file_bytes = await upload.read()
            if not file_bytes or len(file_bytes) < 10 or not file_bytes.startswith(b"%PDF"):
                results.append(
                    {
                        "id": record_id,
                        "filename": filename,
                        "merchant_name": "Corrupted PDF",
                        "customer_name": "",
                        "invoice_number": "",
                        "date": "",
                        "raw_date": "",
                        "total_amount": None,
                        "currency": "USD",
                        "extraction_method": "Error",
                        "confidence": 0,
                        "status": "error",
                        "raw_text": "",
                        "error_message": "File appears to be empty or not a valid PDF header.",
                    }
                )
                continue

            raw_text, method, page_count = ReceiptExtractor.extract_text_from_pdf(file_bytes)
            if not raw_text.strip():
                results.append(
                    {
                        "id": record_id,
                        "filename": filename,
                        "merchant_name": "Unreadable PDF (Manual Entry Needed)",
                        "customer_name": "",
                        "invoice_number": "",
                        "date": "",
                        "raw_date": "",
                        "total_amount": None,
                        "currency": "USD",
                        "extraction_method": method,
                        "page_count": page_count,
                        "confidence": 0,
                        "status": "partial",
                        "raw_text": "",
                        "error_message": "No readable text found via native parser or OCR.",
                    }
                )
                continue

            parsed = ReceiptExtractor.parse_receipt_text(raw_text, filename=filename)
            results.append(
                {
                    "id": record_id,
                    "filename": filename,
                    "merchant_name": parsed["merchant_name"],
                    "customer_name": parsed["customer_name"],
                    "invoice_number": parsed["invoice_number"],
                    "date": parsed["date"],
                    "raw_date": parsed["raw_date"],
                    "total_amount": parsed["total_amount"],
                    "currency": parsed["currency"],
                    "extraction_method": method,
                    "page_count": page_count,
                    "confidence": parsed["confidence"],
                    "status": parsed["status"],
                    "raw_text": raw_text,
                    "error_message": "" if parsed["status"] == "success" else "Some fields may require review.",
                }
            )
        except Exception as exc:
            logger.exception(f"Failed processing PDF {filename}")
            results.append(
                {
                    "id": record_id,
                    "filename": filename,
                    "merchant_name": "Extraction Error",
                    "customer_name": "",
                    "invoice_number": "",
                    "date": "",
                    "raw_date": "",
                    "total_amount": None,
                    "currency": "USD",
                    "extraction_method": "Error",
                    "confidence": 0,
                    "status": "error",
                    "raw_text": "",
                    "error_message": str(exc),
                }
            )

    return {"results": results, "total_processed": len(results)}


@app.post("/api/export/excel")
async def export_excel(request: ExportRequest):
    """Exports the provided receipt records to an Excel (.xlsx) binary stream."""
    if not request.records:
        raise HTTPException(status_code=400, detail="No records provided to export.")
    try:
        excel_bytes = generate_excel_bytes(request.records)
        return Response(
            content=excel_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": 'attachment; filename="receipt_data_export.xlsx"'
            },
        )
    except Exception as exc:
        logger.exception("Excel export failed")
        raise HTTPException(status_code=500, detail=f"Excel generation failed: {exc}")


@app.post("/api/export/json")
async def export_json(request: ExportRequest):
    """Exports the provided receipt records to a formatted JSON file."""
    if not request.records:
        raise HTTPException(status_code=400, detail="No records provided to export.")
    json_str = generate_json_string(request.records)
    return Response(
        content=json_str,
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="receipt_data_export.json"'
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
