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

# Only cache the auth client — NEVER cache the spreadsheet or worksheet.
# Caching the spreadsheet causes stale reads (balance always shows 0).
_client: Optional[gspread.Client] = None


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


# ── ACCOUNTS ─────────────────────────────────────────────────────────────────

def get_all_accounts():
    return _get_sheet().worksheet("Accounts").get_all_records()


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

def get_categories(type_: str) -> list[str]:
    records = _get_sheet().worksheet("Categories").get_all_records()
    return [r["Category"] for r in records if r.get("Type") == type_ and r.get("Category")]


# ── TRANSACTIONS ─────────────────────────────────────────────────────────────

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
) -> dict:
    ws = _get_sheet().worksheet("Transactions")

    now = datetime.now(TZ)
    tx_id = str(uuid.uuid4())[:8].upper()
    date_str = now.strftime("%d.%m.%Y")
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


def get_transactions_by_date_range(date_from: date, date_to: date) -> list[dict]:
    records = _get_sheet().worksheet("Transactions").get_all_records()
    result = []
    for r in records:
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


def get_all_transactions() -> list[dict]:
    """Always fetches fresh data — never cached."""
    return _get_sheet().worksheet("Transactions").get_all_records()


def fmt_amount(amount_uzs, amount_usd=0, usd_rate=0, currency="UZS") -> str:
    uzs = f"{int(float(amount_uzs)):,}".replace(",", " ") + " сум"
    if currency == "USD" and amount_usd:
        usd = f"${float(amount_usd):,.2f}"
        return f"{usd} ({uzs})"
    return uzs
