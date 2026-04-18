"""api/server.py — Flask REST API for FinApp Factory WebApp.
Runs in a background thread alongside the Telegram bot.
"""

import os
import json
import logging
import hashlib
import hmac
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS

logger = logging.getLogger(__name__)

import pathlib

_STATIC = pathlib.Path(__file__).parent.parent / "static"

app = Flask(
    __name__,
    static_folder=str(_STATIC) if _STATIC.exists() else None,
    static_url_path="",
)
CORS(app, origins="*")

# ── Lazy import sheets so we reuse the bot's auth ────────────────────────────

def _sheets():
    from utils import sheets
    return sheets


# ── Auth helpers ─────────────────────────────────────────────────────────────

def _verify_telegram_init_data(init_data: str) -> dict | None:
    """Validate Telegram WebApp initData HMAC and return parsed user dict."""
    from urllib.parse import unquote
    bot_token = os.environ.get("BOT_TOKEN", "")
    try:
        pairs = {}
        hash_val = None
        for part in init_data.split("&"):
            k, _, v = part.partition("=")
            k = unquote(k)
            v = unquote(v)
            if k == "hash":
                hash_val = v
            else:
                pairs[k] = v
        if not hash_val:
            return None
        check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
        secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        computed = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(computed, hash_val):
            logger.warning("HMAC mismatch. computed=%s hash=%s", computed, hash_val)
            return None
        if "user" in pairs:
            return json.loads(pairs["user"])
        return {}
    except Exception as e:
        logger.warning("init_data verify error: %s", e)
        return None


def require_auth(f):
    """Decorator: authenticate via Telegram initData or manual TG_ID header."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        # Option 1: Telegram WebApp initData
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        if init_data:
            tg_user = _verify_telegram_init_data(init_data)
            if tg_user is None:
                return jsonify({"error": "Invalid Telegram auth"}), 401
            tg_id = str(tg_user.get("id", ""))
        else:
            # Option 2: manual TG_ID (browser fallback)
            tg_id = request.headers.get("X-TG-ID", "").strip()
            if not tg_id:
                return jsonify({"error": "No auth provided"}), 401

        sheets = _sheets()
        role = sheets.get_user_role(int(tg_id))
        if not role:
            return jsonify({"error": "Access denied"}), 403

        request.tg_id = tg_id
        request.user_role = role
        return f(*args, **kwargs)
    return wrapper


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.get("/")
@app.get("/<path:path>")
def serve_spa(path=""):
    """Serve React SPA — API routes take priority via url ordering."""
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    index = _STATIC / "index.html"
    if index.exists():
        return index.read_text(), 200, {"Content-Type": "text/html"}
    return "Frontend not built. Run: cd frontend && npm run build", 200


@app.get("/api/auth/me")
@require_auth
def me():
    """Return current user info from Accounts sheet."""
    sheets = _sheets()
    try:
        ws = sheets._get_sheet().worksheet("Accounts")
        records = sheets._rows_to_dicts(ws, sheets.ACCOUNT_HEADERS)
        for r in records:
            if str(r.get("TG_ID", "")).strip() == str(request.tg_id):
                return jsonify({
                    "TG_ID": str(r.get("TG_ID", "")),
                    "Username": r.get("Username", ""),
                    "Full_Name": r.get("Full_Name", ""),
                    "Role": r.get("Role", ""),
                    "Active": r.get("Active", ""),
                })
        return jsonify({"error": "User not found"}), 404
    except Exception as e:
        logger.error("me error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.get("/api/categories")
@require_auth
def categories():
    sheets = _sheets()
    try:
        sh = sheets._get_sheet()
        ws = sh.worksheet("Categories")
        records = ws.get_all_records()
        return jsonify([
            {"Category": r["Category"], "Type": r["Type"]}
            for r in records if r.get("Category")
        ])
    except Exception as e:
        logger.error("categories error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.get("/api/transactions")
@require_auth
def get_transactions():
    sheets = _sheets()
    try:
        records = sheets.get_all_transactions()
        return jsonify(list(reversed(records)))
    except Exception as e:
        logger.error("get_transactions error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.post("/api/transactions")
@require_auth
def add_transaction():
    if request.user_role not in ("editor", "finance_director"):
        return jsonify({"error": "Forbidden"}), 403
    sheets = _sheets()
    data = request.get_json() or {}
    try:
        result = sheets.log_transaction(
            type_=data["Type"],
            category=data["Category"],
            amount_uzs=float(data.get("Amount_UZS", 0)),
            note=data.get("Note", ""),
            editor_id=int(request.tg_id),
            editor_name=data.get("Editor_Name", ""),
            amount_usd=float(data.get("Amount_USD", 0)),
            usd_rate=float(data.get("USD_Rate", 0)),
            currency=data.get("Currency", "UZS"),
            tx_date=data.get("Date"),
        )
        # Notify group if configured
        _notify_group(data, request.tg_id)
        return jsonify(result), 201
    except Exception as e:
        logger.error("add_transaction error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.delete("/api/transactions/<tx_id>")
@require_auth
def delete_transaction(tx_id):
    if request.user_role not in ("editor", "finance_director"):
        return jsonify({"error": "Forbidden"}), 403
    sheets = _sheets()
    ok = sheets.delete_transaction(tx_id)
    if ok:
        return jsonify({"ok": True})
    return jsonify({"error": "Not found"}), 404


@app.patch("/api/transactions/<tx_id>")
@require_auth
def edit_transaction(tx_id):
    if request.user_role not in ("editor", "finance_director"):
        return jsonify({"error": "Forbidden"}), 403
    sheets = _sheets()
    data = request.get_json() or {}
    try:
        sh = sheets._get_sheet()
        ws = sh.worksheet("Transactions")
        all_rows = ws.get_all_values()
        headers = all_rows[0]
        for i, row in enumerate(all_rows[1:], start=2):
            if row and str(row[0]).upper() == tx_id.upper():
                for field, value in data.items():
                    if field in headers:
                        col = headers.index(field) + 1
                        ws.update_cell(i, col, value)
                return jsonify({"ok": True})
        return jsonify({"error": "Not found"}), 404
    except Exception as e:
        logger.error("edit_transaction error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.get("/api/balance")
@require_auth
def balance():
    try:
        from utils.reports import get_balance_details, format_balance_message
        bal = get_balance_details()
        return jsonify(bal)
    except Exception as e:
        logger.error("balance error: %s", e)
        return jsonify({"error": str(e)}), 500


# ── Group notification helper ────────────────────────────────────────────────

def _notify_group(data: dict, tg_id: str):
    """Fire-and-forget Telegram message to GROUP_CHAT_ID."""
    import threading
    group_chat_id = os.environ.get("GROUP_CHAT_ID")
    bot_token = os.environ.get("BOT_TOKEN")
    if not group_chat_id or not bot_token:
        return

    def _send():
        import requests as req
        sign = "🟢 Приход" if data.get("Type") == "income" else "🔴 Расход"
        amt = (
            f"${data.get('Amount_USD', 0)}"
            if data.get("Currency") == "USD"
            else f"{int(float(data.get('Amount_USD') or data.get('Amount_UZS', 0))):,} сум".replace(",", " ")
        )
        text = (
            f"{sign} | <b>{data.get('Category', '')}</b>\n"
            f"💵 {amt}\n"
            f"📝 {data.get('Note', '')}\n"
            f"👤 {data.get('Editor_Name', '')} (webapp)"
        )
        try:
            req.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": group_chat_id, "text": text, "parse_mode": "HTML"},
                timeout=5,
            )
        except Exception as e:
            logger.warning("group notify failed: %s", e)

    threading.Thread(target=_send, daemon=True).start()


# ── Startup helper called from main.py ───────────────────────────────────────

def run_api(port: int = 5000):
    import threading
    t = threading.Thread(
        target=lambda: app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False),
        daemon=True,
        name="flask-api",
    )
    t.start()
    logger.info("Flask API started on port %s", port)
