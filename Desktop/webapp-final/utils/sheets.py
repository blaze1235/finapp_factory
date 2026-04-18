"""utils/sheets.py — All Google Sheets interactions."""

import os, json, uuid
from datetime import datetime, date
from typing import Optional
import gspread
from google.oauth2.service_account import Credentials
import pytz

TZ = pytz.timezone("Asia/Tashkent")
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

_client: Optional[gspread.Client] = None

TRANSACTION_HEADERS = [
    "ID", "Timestamp", "Date", "Type", "Category",
    "Amount_UZS", "Amount_USD", "USD_Rate", "Note",
    "Editor_ID", "Editor_Name", "Currency"
]


def _get_client() -> gspread.Client:
    global _client
    if _client is None:
        creds_file = os.environ.get("GOOGLE_CREDENTIALS_FILE", "credentials.json")
        if os.path.exists(creds_file):
            with open(creds_file) as f:
                creds_dict = json.load(f)
        else:
            creds_dict = json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"])
        creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
        _client = gspread.authorize(creds)
    return _client


def _get_sheet():
    """Fresh spreadsheet reference every call — never cached."""
    return _get_client().open_by_key(os.environ["GOOGLE_SHEET_ID"])


def _rows_to_dicts(ws, headers: list[str]) -> list[dict]:
    """
    Safely convert worksheet rows to dicts using our own header list.
    Avoids gspread's get_all_records() which crashes on duplicate headers.
    Skips completely empty rows.
    """
    all_rows = ws.get_all_values()
    if not all_rows:
        return []
    # Skip the actual header row (row 1) — we use our own
    data_rows = all_rows[1:]
    result = []
    for row in data_rows:
        # Pad short rows
        padded = row + [""] * (len(headers) - len(row))
        d = {headers[i]: padded[i] for i in range(len(headers))}
        # Skip fully empty rows
        if all(v == "" for v in d.values()):
            continue
        result.append(d)
    return result


# ── ACCOUNTS ─────────────────────────────────────────────────────────────────

ACCOUNT_HEADERS = ["TG_ID", "Username", "Full_Name", "Role", "Active"]

def get_all_accounts():
    ws = _get_sheet().worksheet("Accounts")
    return _rows_to_dicts(ws, ACCOUNT_HEADERS)


def get_user_role(tg_id: int) -> Optional[str]:
    for acc in get_all_accounts():
        if str(acc.get("TG_ID", "")) == str(tg_id) and str(acc.get("Active", "")).upper() == "TRUE":
            return acc.get("Role", "").strip().lower()
    return None


def get_directors_and_finance() -> list[int]:
    ids = []
    for acc in get_all_accounts():
        role = acc.get("Role", "").strip().lower()
        if role in ("director", "finance_director") and str(acc.get("Active", "")).upper() == "TRUE":
            try:
                ids.append(int(acc["TG_ID"]))
            except (ValueError, KeyError):
                pass
    return ids


# ── CATEGORIES ───────────────────────────────────────────────────────────────

CATEGORY_HEADERS = ["Type", "Category"]

def get_categories(type_: str) -> list[str]:
    ws = _get_sheet().worksheet("Categories")
    records = _rows_to_dicts(ws, CATEGORY_HEADERS)
    return [r["Category"] for r in records if r.get("Type") == type_ and r.get("Category")]


# ── TRANSACTIONS ─────────────────────────────────────────────────────────────

def _ensure_transaction_headers(ws):
    """Write correct headers to row 1 if they're wrong or missing."""
    existing = ws.row_values(1)
    if existing != TRANSACTION_HEADERS:
        ws.update("A1", [TRANSACTION_HEADERS])


def log_transaction(
    type_: str,
    category: str,
    amount_uzs: float,
    note: str,
    editor_id: int,
    editor_name: str,
    amount_usd: float = 0.0,
    usd_rate: float = 0.0,
    currency: str = "UZS",
    tx_date: str = None,   # optional DD.MM.YYYY override
) -> dict:
    ws = _get_sheet().worksheet("Transactions")
    _ensure_transaction_headers(ws)

    now = datetime.now(TZ)
    tx_id = str(uuid.uuid4())[:8].upper()
    date_str = tx_date if tx_date else now.strftime("%d.%m.%Y")
    ts_str = now.strftime("%d.%m.%Y %H:%M:%S")

    row = [
        tx_id, ts_str, date_str, type_, category,
        amount_uzs, amount_usd if amount_usd else "",
        usd_rate if usd_rate else "", note,
        editor_id, editor_name, currency
    ]
    ws.append_row(row, value_input_option="USER_ENTERED")

    return {
        "id": tx_id,
        "timestamp": ts_str,
        "date": date_str,
        "type": type_,
        "category": category,
        "amount_uzs": amount_uzs,
        "amount_usd": amount_usd,
        "usd_rate": usd_rate,
        "note": note,
        "editor_name": editor_name,
        "currency": currency,
    }


def get_all_transactions() -> list[dict]:
    """Always fetches fresh data. Uses our own headers — immune to sheet header issues."""
    ws = _get_sheet().worksheet("Transactions")
    return _rows_to_dicts(ws, TRANSACTION_HEADERS)


def get_transactions_by_date_range(date_from: date, date_to: date) -> list[dict]:
    result = []
    for r in get_all_transactions():
        if not r.get("Date"):
            continue
        try:
            tx_date = datetime.strptime(r["Date"], "%d.%m.%Y").date()
        except ValueError:
            continue
        if date_from <= tx_date <= date_to:
            result.append(r)
    return result


def get_transactions_by_date(target_date: date) -> list[dict]:
    return get_transactions_by_date_range(target_date, target_date)


def delete_transaction(tx_id: str) -> bool:
    """Delete a transaction row by ID. Returns True if found and deleted."""
    ws = _get_sheet().worksheet("Transactions")
    all_rows = ws.get_all_values()
    for i, row in enumerate(all_rows):
        if row and str(row[0]).upper() == tx_id.upper():
            ws.delete_rows(i + 1)  # gspread rows are 1-indexed
            return True
    return False


def fmt_amount(amount_uzs, amount_usd=0, usd_rate=0, currency="UZS") -> str:
    uzs = f"{int(float(amount_uzs)):,}".replace(",", " ") + " сум"
    if currency == "USD" and amount_usd:
        usd = f"${float(amount_usd):,.2f}"
        return f"{usd} ({uzs})"
    return uzs
