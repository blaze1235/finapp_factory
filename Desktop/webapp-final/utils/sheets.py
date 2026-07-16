"""utils/sheets.py — All Google Sheets interactions."""

import os, json, uuid, time
from datetime import datetime, date
from typing import Optional
import gspread
from google.oauth2.service_account import Credentials
import pytz

# Short TTL cache for read-heavy, rarely-changing data (accounts, categories).
# The Sheets API allows only 60 reads/min per service account — without this,
# auth alone (which reads Accounts on every request) can exhaust the quota.
_TTL_CACHE: dict = {}

def _cached(key: str, ttl: float, fn):
    hit = _TTL_CACHE.get(key)
    now = time.time()
    if hit and hit[0] > now:
        return hit[1]
    value = fn()
    _TTL_CACHE[key] = (now + ttl, value)
    return value

def _invalidate(prefix: str):
    for k in list(_TTL_CACHE):
        if k.startswith(prefix):
            del _TTL_CACHE[k]

TZ = pytz.timezone("Asia/Tashkent")
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

_client: Optional[gspread.Client] = None

TRANSACTION_HEADERS = [
    "ID", "Timestamp", "Date", "Type", "Category",
    "Amount_UZS", "Amount_USD", "USD_Rate", "Note",
    "Editor_ID", "Editor_Name", "Currency", "Subcategory"
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
    def fetch():
        ws = _get_sheet().worksheet("Accounts")
        return _rows_to_dicts(ws, ACCOUNT_HEADERS)
    return _cached("accounts", 60, fetch)


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


# ── CATEGORIES & SUBCATEGORIES ───────────────────────────────────────────────

CATEGORY_HEADERS = ["Type", "Category"]
SUBCATEGORY_HEADERS = ["Type", "Category", "Subcategory"]
EDITLOG_HEADERS = ["Timestamp", "TX_ID", "Editor_ID", "Editor_Name", "Reason", "Changes"]


def _ws_or_create(title: str, headers: list[str]):
    """Get a worksheet, creating it with the given header row if missing."""
    sh = _get_sheet()
    try:
        return sh.worksheet(title)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=title, rows=200, cols=max(len(headers), 6))
        ws.update("A1", [headers])
        return ws


def get_categories(type_: str) -> list[str]:
    def fetch():
        ws = _get_sheet().worksheet("Categories")
        return _rows_to_dicts(ws, CATEGORY_HEADERS)
    records = _cached("categories:list", 30, fetch)
    return [r["Category"] for r in records if r.get("Type") == type_ and r.get("Category")]


def get_subcategories(type_: str, category: str) -> list[str]:
    def fetch():
        ws = _ws_or_create("Subcategories", SUBCATEGORY_HEADERS)
        return _rows_to_dicts(ws, SUBCATEGORY_HEADERS)
    records = _cached("categories:subs", 30, fetch)
    return [
        r["Subcategory"] for r in records
        if r.get("Type") == type_ and r.get("Category") == category and r.get("Subcategory")
    ]


def get_categories_full() -> list[dict]:
    """All categories with their subcategories: [{Type, Category, Subcategories}]."""
    def fetch_cats():
        return _rows_to_dicts(_get_sheet().worksheet("Categories"), CATEGORY_HEADERS)
    def fetch_subs():
        return _rows_to_dicts(_ws_or_create("Subcategories", SUBCATEGORY_HEADERS), SUBCATEGORY_HEADERS)
    cats = _cached("categories:list", 30, fetch_cats)
    subs = _cached("categories:subs", 30, fetch_subs)
    out = []
    for r in cats:
        if not r.get("Category"):
            continue
        out.append({
            "Type": r.get("Type", ""),
            "Category": r["Category"],
            "Subcategories": [
                s["Subcategory"] for s in subs
                if s.get("Type") == r.get("Type") and s.get("Category") == r["Category"] and s.get("Subcategory")
            ],
        })
    return out


def _find_row(ws, headers: list[str], match: dict) -> int:
    """1-based row index of the first data row matching all {header: value}, or 0."""
    all_rows = ws.get_all_values()
    idx = {h: i for i, h in enumerate(headers)}
    for i, row in enumerate(all_rows[1:], start=2):
        padded = row + [""] * (len(headers) - len(row))
        if all(padded[idx[k]] == v for k, v in match.items()):
            return i
    return 0


def _cascade_transactions(match: dict, set_fields: dict):
    """Batch-update all transaction rows matching {header: value} with new values."""
    ws = _get_sheet().worksheet("Transactions")
    all_rows = ws.get_all_values()
    idx = {h: i for i, h in enumerate(TRANSACTION_HEADERS)}
    updates = []
    for i, row in enumerate(all_rows[1:], start=2):
        padded = row + [""] * (len(TRANSACTION_HEADERS) - len(row))
        if all(padded[idx[k]] == v for k, v in match.items()):
            for field, value in set_fields.items():
                col = idx[field] + 1
                updates.append({"range": gspread.utils.rowcol_to_a1(i, col), "values": [[value]]})
    if updates:
        ws.batch_update(updates, value_input_option="USER_ENTERED")


def add_category(type_: str, name: str):
    name = name.strip()
    if not name:
        raise ValueError("Пустое название категории")
    if name in get_categories(type_):
        raise ValueError("Такая категория уже существует")
    ws = _get_sheet().worksheet("Categories")
    ws.append_row([type_, name], value_input_option="USER_ENTERED")

    _invalidate("categories")

def rename_category(type_: str, old: str, new: str):
    new = new.strip()
    if not new:
        raise ValueError("Пустое название категории")
    if new != old and new in get_categories(type_):
        raise ValueError("Такая категория уже существует")
    ws = _get_sheet().worksheet("Categories")
    row = _find_row(ws, CATEGORY_HEADERS, {"Type": type_, "Category": old})
    if not row:
        raise ValueError("Категория не найдена")
    ws.update_cell(row, CATEGORY_HEADERS.index("Category") + 1, new)
    # Cascade to subcategories tab
    sub_ws = _ws_or_create("Subcategories", SUBCATEGORY_HEADERS)
    while True:
        r = _find_row(sub_ws, SUBCATEGORY_HEADERS, {"Type": type_, "Category": old})
        if not r:
            break
        sub_ws.update_cell(r, SUBCATEGORY_HEADERS.index("Category") + 1, new)
    # Cascade to transactions
    _cascade_transactions({"Type": type_, "Category": old}, {"Category": new})

    _invalidate("categories")

def delete_category(type_: str, name: str):
    ws = _get_sheet().worksheet("Categories")
    row = _find_row(ws, CATEGORY_HEADERS, {"Type": type_, "Category": name})
    if not row:
        raise ValueError("Категория не найдена")
    ws.delete_rows(row)
    sub_ws = _ws_or_create("Subcategories", SUBCATEGORY_HEADERS)
    while True:
        r = _find_row(sub_ws, SUBCATEGORY_HEADERS, {"Type": type_, "Category": name})
        if not r:
            break
        sub_ws.delete_rows(r)

    _invalidate("categories")

def add_subcategory(type_: str, category: str, name: str):
    name = name.strip()
    if not name:
        raise ValueError("Пустое название подкатегории")
    if category not in get_categories(type_):
        raise ValueError("Категория не найдена")
    if name in get_subcategories(type_, category):
        raise ValueError("Такая подкатегория уже существует")
    ws = _ws_or_create("Subcategories", SUBCATEGORY_HEADERS)
    ws.append_row([type_, category, name], value_input_option="USER_ENTERED")

    _invalidate("categories")

def rename_subcategory(type_: str, category: str, old: str, new: str):
    new = new.strip()
    if not new:
        raise ValueError("Пустое название подкатегории")
    if new != old and new in get_subcategories(type_, category):
        raise ValueError("Такая подкатегория уже существует")
    ws = _ws_or_create("Subcategories", SUBCATEGORY_HEADERS)
    row = _find_row(ws, SUBCATEGORY_HEADERS, {"Type": type_, "Category": category, "Subcategory": old})
    if not row:
        raise ValueError("Подкатегория не найдена")
    ws.update_cell(row, SUBCATEGORY_HEADERS.index("Subcategory") + 1, new)
    _cascade_transactions(
        {"Type": type_, "Category": category, "Subcategory": old},
        {"Subcategory": new},
    )

    _invalidate("categories")

def delete_subcategory(type_: str, category: str, name: str):
    ws = _ws_or_create("Subcategories", SUBCATEGORY_HEADERS)
    row = _find_row(ws, SUBCATEGORY_HEADERS, {"Type": type_, "Category": category, "Subcategory": name})
    if not row:
        raise ValueError("Подкатегория не найдена")
    ws.delete_rows(row)

    _invalidate("categories")

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
    subcategory: str = "",
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
        editor_id, editor_name, currency, subcategory
    ]
    ws.append_row(row, value_input_option="USER_ENTERED")

    return {
        "id": tx_id,
        "timestamp": ts_str,
        "date": date_str,
        "type": type_,
        "category": category,
        "subcategory": subcategory,
        "amount_uzs": amount_uzs,
        "amount_usd": amount_usd,
        "usd_rate": usd_rate,
        "note": note,
        "editor_name": editor_name,
        "currency": currency,
    }


def update_transaction(tx_id: str, fields: dict) -> Optional[dict]:
    """Update fields of a transaction by ID. Returns {field: {old, new}} of real
    changes, or None if the transaction wasn't found."""
    ws = _get_sheet().worksheet("Transactions")
    _ensure_transaction_headers(ws)
    all_rows = ws.get_all_values()
    idx = {h: i for i, h in enumerate(TRANSACTION_HEADERS)}
    for i, row in enumerate(all_rows[1:], start=2):
        if row and str(row[0]).upper() == tx_id.upper():
            padded = row + [""] * (len(TRANSACTION_HEADERS) - len(row))
            changes = {}
            updates = []
            for field, value in fields.items():
                if field not in idx or field == "ID":
                    continue
                old = padded[idx[field]]
                if str(old) == str(value):
                    continue
                changes[field] = {"old": old, "new": value}
                updates.append({
                    "range": gspread.utils.rowcol_to_a1(i, idx[field] + 1),
                    "values": [[value]],
                })
            if updates:
                ws.batch_update(updates, value_input_option="USER_ENTERED")
            return changes
    return None


# ── EDIT LOG (audit trail) ───────────────────────────────────────────────────

def append_edit_log(tx_id: str, editor_id, editor_name: str, reason: str, changes: dict):
    ws = _ws_or_create("Edit_Log", EDITLOG_HEADERS)
    ts = datetime.now(TZ).strftime("%d.%m.%Y %H:%M:%S")
    changes_str = "; ".join(
        f"{f}: {c['old'] or '—'} → {c['new'] or '—'}" for f, c in changes.items()
    )
    ws.append_row([ts, tx_id, editor_id, editor_name, reason, changes_str],
                  value_input_option="USER_ENTERED")


def get_edit_log(tx_id: str = None) -> list[dict]:
    ws = _ws_or_create("Edit_Log", EDITLOG_HEADERS)
    records = _rows_to_dicts(ws, EDITLOG_HEADERS)
    if tx_id:
        records = [r for r in records if str(r.get("TX_ID", "")).upper() == tx_id.upper()]
    return records


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
