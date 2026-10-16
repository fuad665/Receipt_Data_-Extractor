import io
import json
from collections import defaultdict
from datetime import datetime
from typing import List, Dict, Any

import pandas as pd
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


def _build_analytics(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    customer_map: Dict[str, Dict[str, Any]] = {}
    date_map: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"count": 0, "total": 0.0, "customers": []}
    )
    total_revenue = 0.0

    for rec in records:
        name = (rec.get("merchant_name") or "Unknown Customer").strip()
        key = " ".join(name.lower().split())
        try:
            amt = float(rec["total_amount"]) if rec.get("total_amount") not in (None, "") else 0.0
        except (ValueError, TypeError):
            amt = 0.0
        date_str = (rec.get("date") or "").strip()
        total_revenue += amt

        if key not in customer_map:
            customer_map[key] = {
                "name": name,
                "count": 0,
                "total": 0.0,
                "dates": [],
            }
        customer_map[key]["count"] += 1
        customer_map[key]["total"] = round(customer_map[key]["total"] + amt, 2)
        if date_str:
            customer_map[key]["dates"].append(date_str)

        d_key = date_str or "Unscheduled / No Date"
        date_map[d_key]["count"] += 1
        date_map[d_key]["total"] = round(date_map[d_key]["total"] + amt, 2)
        date_map[d_key]["customers"].append(f"{name} (${amt:,.2f})")

    customers = []
    for item in customer_map.values():
        sorted_dates = sorted(item["dates"])
        count = item["count"]
        total = item["total"]
        customers.append(
            {
                "name": item["name"],
                "type": f"REPEAT CUSTOMER ({count}x)" if count >= 2 else "One-Time Customer",
                "is_repeat": count >= 2,
                "count": count,
                "total": total,
                "avg": round(total / count, 2) if count else 0.0,
                "share": f"{round((total / total_revenue) * 100, 1)}%" if total_revenue > 0 else "0%",
                "first_date": sorted_dates[0] if sorted_dates else "N/A",
                "last_date": sorted_dates[-1] if sorted_dates else "N/A",
                "all_dates": ", ".join(sorted_dates),
            }
        )
    customers.sort(key=lambda x: (-x["count"], -x["total"]))

    dates_list = [
        {
            "date": k,
            "count": v["count"],
            "total": v["total"],
            "customers": "; ".join(v["customers"]),
        }
        for k, v in date_map.items()
    ]
    dates_list.sort(key=lambda x: (x["date"] == "Unscheduled / No Date", x["date"]), reverse=True)

    return {
        "total_revenue": round(total_revenue, 2),
        "customers": customers,
        "dates": dates_list,
    }


def _style_worksheet(worksheet, num_rows: int, num_cols: int, amount_cols: tuple = ()):
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    body_font = Font(name="Calibri", size=11, color="1E293B")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    worksheet.row_dimensions[1].height = 28
    for col_idx in range(1, num_cols + 1):
        cell = worksheet.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="left", vertical="center")
        cell.border = thin_border

    for row_idx in range(2, num_rows + 2):
        worksheet.row_dimensions[row_idx].height = 22
        for col_idx in range(1, num_cols + 1):
            cell = worksheet.cell(row=row_idx, column=col_idx)
            cell.font = body_font
            cell.border = thin_border
            if col_idx in amount_cols:
                cell.number_format = "#,##0.00"
                cell.alignment = Alignment(horizontal="right", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")

    for col_idx in range(1, num_cols + 1):
        col_letter = get_column_letter(col_idx)
        max_len = len(str(worksheet.cell(row=1, column=col_idx).value or ""))
        for row_idx in range(2, num_rows + 2):
            val = worksheet.cell(row=row_idx, column=col_idx).value
            if val is not None:
                max_len = max(max_len, len(str(val)))
        worksheet.column_dimensions[col_letter].width = min(max(max_len + 5, 12), 50)


def generate_excel_bytes(records: List[Dict[str, Any]]) -> bytes:
    """
    Converts a list of extracted receipt records into a 3-sheet Excel (.xlsx) workbook:
    1. Extracted Receipts
    2. Customer Repeat Analysis
    3. Payment Date Monitor
    """
    analytics = _build_analytics(records)

    rows = []
    for idx, rec in enumerate(records, start=1):
        amount = rec.get("total_amount")
        try:
            numeric_amount = float(amount) if amount is not None and amount != "" else 0.0
        except (ValueError, TypeError):
            numeric_amount = 0.0

        rows.append(
            {
                "#": idx,
                "File Name": rec.get("filename", ""),
                "Customer / Merchant Name": rec.get("merchant_name", ""),
                "Customer (Billed To)": rec.get("customer_name", ""),
                "Invoice / Receipt #": rec.get("invoice_number", ""),
                "Date": rec.get("date", ""),
                "Currency": rec.get("currency", "USD"),
                "Total Amount": numeric_amount,
                "Extraction Method": rec.get("extraction_method", "Native PDF"),
                "Status": (rec.get("status") or "success").upper(),
            }
        )

    customer_rows = [
        {
            "#": idx,
            "Customer / Merchant Name": c["name"],
            "Customer Type": c["type"],
            "Total Payments Count": c["count"],
            "Total Amount Paid": c["total"],
            "Average Payment": c["avg"],
            "Revenue Share (%)": c["share"],
            "First Payment Date": c["first_date"],
            "Latest Payment Date": c["last_date"],
            "All Payment Dates": c["all_dates"],
        }
        for idx, c in enumerate(analytics["customers"], start=1)
    ]

    date_rows = [
        {
            "#": idx,
            "Payment Date": d["date"],
            "Number of Payments": d["count"],
            "Total Amount Collected": d["total"],
            "Customers Who Paid": d["customers"],
        }
        for idx, d in enumerate(analytics["dates"], start=1)
    ]

    df_receipts = pd.DataFrame(rows)
    df_customers = pd.DataFrame(customer_rows)
    df_dates = pd.DataFrame(date_rows)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df_receipts.to_excel(writer, index=False, sheet_name="Extracted Receipts")
        df_customers.to_excel(writer, index=False, sheet_name="Customer Repeat Analysis")
        df_dates.to_excel(writer, index=False, sheet_name="Payment Date Monitor")

        _style_worksheet(
            writer.sheets["Extracted Receipts"], len(rows), len(df_receipts.columns), amount_cols=(8,)
        )
        _style_worksheet(
            writer.sheets["Customer Repeat Analysis"],
            len(customer_rows),
            len(df_customers.columns),
            amount_cols=(5, 6),
        )
        _style_worksheet(
            writer.sheets["Payment Date Monitor"],
            len(date_rows),
            len(df_dates.columns),
            amount_cols=(4,),
        )

    output.seek(0)
    return output.read()


def generate_json_string(records: List[Dict[str, Any]]) -> str:
    """
    Generates a clean, structured JSON payload with summary metadata,
    customer repeat analysis, payment date monitor, and raw records.
    """
    analytics = _build_analytics(records)
    repeat_count = sum(1 for c in analytics["customers"] if c["is_repeat"])

    payload = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "total_receipts": len(records),
            "aggregate_amount": analytics["total_revenue"],
            "unique_customers": len(analytics["customers"]),
            "repeat_customers": repeat_count,
        },
        "customer_repeat_analysis": analytics["customers"],
        "payment_date_monitor": analytics["dates"],
        "records": [
            {
                "id": r.get("id"),
                "filename": r.get("filename"),
                "merchant_name": r.get("merchant_name"),
                "customer_name": r.get("customer_name", ""),
                "invoice_number": r.get("invoice_number", ""),
                "date": r.get("date"),
                "currency": r.get("currency", "USD"),
                "total_amount": (
                    round(float(r["total_amount"]), 2)
                    if r.get("total_amount") not in (None, "")
                    else None
                ),
                "extraction_method": r.get("extraction_method", "Native PDF"),
                "confidence": r.get("confidence", 100),
                "status": r.get("status", "success"),
            }
            for r in records
        ],
    }
    return json.dumps(payload, indent=2)
