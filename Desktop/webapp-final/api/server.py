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
    """Categories with their subcategories: [{Type, Category, Subcategories}]."""
    sheets = _sheets()
    try:
        return jsonify(sheets.get_categories_full())
    except Exception as e:
        logger.error("categories error: %s", e)
        return jsonify({"error": str(e)}), 500


def _require_editor():
    if request.user_role not in ("editor", "finance_director"):
        return jsonify({"error": "Forbidden"}), 403
    return None


@app.post("/api/categories")
@require_auth
def add_category():
    forbidden = _require_editor()
    if forbidden:
        return forbidden
    data = request.get_json() or {}
    type_, name = data.get("Type", ""), data.get("Category", "")
    if type_ not in ("income", "expense") or not name.strip():
        return jsonify({"error": "Нужны Type (income/expense) и Category"}), 400
    try:
        _sheets().add_category(type_, name)
        return jsonify({"ok": True}), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("add_category error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.patch("/api/categories")
@require_auth
def rename_category():
    forbidden = _require_editor()
    if forbidden:
        return forbidden
    data = request.get_json() or {}
    type_, old, new = data.get("Type", ""), data.get("Category", ""), data.get("NewName", "")
    if not (type_ and old and new.strip()):
        return jsonify({"error": "Нужны Type, Category и NewName"}), 400
    try:
        _sheets().rename_category(type_, old, new)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("rename_category error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.delete("/api/categories")
@require_auth
def delete_category():
    forbidden = _require_editor()
    if forbidden:
        return forbidden
    data = request.get_json() or {}
    type_, name = data.get("Type", ""), data.get("Category", "")
    if not (type_ and name):
        return jsonify({"error": "Нужны Type и Category"}), 400
    try:
        _sheets().delete_category(type_, name)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("delete_category error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.post("/api/subcategories")
@require_auth
def add_subcategory():
    forbidden = _require_editor()
    if forbidden:
        return forbidden
    data = request.get_json() or {}
    type_, cat, name = data.get("Type", ""), data.get("Category", ""), data.get("Subcategory", "")
    if not (type_ and cat and name.strip()):
        return jsonify({"error": "Нужны Type, Category и Subcategory"}), 400
    try:
        _sheets().add_subcategory(type_, cat, name)
        return jsonify({"ok": True}), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("add_subcategory error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.patch("/api/subcategories")
@require_auth
def rename_subcategory():
    forbidden = _require_editor()
    if forbidden:
        return forbidden
    data = request.get_json() or {}
    type_, cat = data.get("Type", ""), data.get("Category", "")
    old, new = data.get("Subcategory", ""), data.get("NewName", "")
    if not (type_ and cat and old and new.strip()):
        return jsonify({"error": "Нужны Type, Category, Subcategory и NewName"}), 400
    try:
        _sheets().rename_subcategory(type_, cat, old, new)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("rename_subcategory error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.delete("/api/subcategories")
@require_auth
def delete_subcategory():
    forbidden = _require_editor()
    if forbidden:
        return forbidden
    data = request.get_json() or {}
    type_, cat, name = data.get("Type", ""), data.get("Category", ""), data.get("Subcategory", "")
    if not (type_ and cat and name):
        return jsonify({"error": "Нужны Type, Category и Subcategory"}), 400
    try:
        _sheets().delete_subcategory(type_, cat, name)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("delete_subcategory error: %s", e)
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
            subcategory=data.get("Subcategory", ""),
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
    """Edit a transaction. A non-empty `Reason` is mandatory; every change is
    written to the Edit_Log sheet (who, when, why, what changed).
    Exception: completing a draft (Type draft → income/expense) needs no reason."""
    if request.user_role not in ("editor", "finance_director"):
        return jsonify({"error": "Forbidden"}), 403
    sheets = _sheets()
    data = request.get_json() or {}
    reason = str(data.pop("Reason", "") or "").strip()
    editor_name = str(data.pop("Editor_Name", "") or "")
    is_draft_completion = bool(data.pop("DraftCompletion", False))
    if not data:
        return jsonify({"error": "Нет изменений"}), 400
    if not is_draft_completion and len(reason) < 3:
        return jsonify({"error": "Укажите причину изменения (обязательно)"}), 400
    try:
        changes = sheets.update_transaction(tx_id, data)
        if changes is None:
            return jsonify({"error": "Not found"}), 404
        if changes and not is_draft_completion:
            sheets.append_edit_log(tx_id, request.tg_id, editor_name, reason, changes)
        return jsonify({"ok": True, "changed": list(changes.keys())})
    except Exception as e:
        logger.error("edit_transaction error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.get("/api/transactions/<tx_id>/history")
@require_auth
def transaction_history(tx_id):
    try:
        return jsonify(_sheets().get_edit_log(tx_id))
    except Exception as e:
        logger.error("transaction_history error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.get("/api/analytics/summary")
@require_auth
def analytics_summary():
    """Structured analytics for a period — the single data contract for the UI
    and for future AI analysis. ?period=YYYY-MM | all (default: current month).

    Returns: period, totals (income/expense/net, USD, counts), by_category
    (with per-subcategory breakdown), daily series, available_months.
    """
    from datetime import datetime as dt
    sheets = _sheets()
    period = request.args.get("period", "").strip() or dt.now().strftime("%Y-%m")
    try:
        txs = [t for t in sheets.get_all_transactions() if t.get("Type") in ("income", "expense")]

        def month_key(t):
            try:
                d = dt.strptime(t.get("Date", ""), "%d.%m.%Y")
                return d.strftime("%Y-%m")
            except ValueError:
                return None

        available_months = sorted({m for m in (month_key(t) for t in txs) if m}, reverse=True)
        if period != "all":
            txs = [t for t in txs if month_key(t) == period]

        totals = {"income_uzs": 0.0, "expense_uzs": 0.0, "income_usd": 0.0, "expense_usd": 0.0,
                  "income_count": 0, "expense_count": 0}
        by_category = {}
        daily = {}
        for t in txs:
            typ = t["Type"]
            uzs = float(t.get("Amount_UZS") or 0)
            usd = float(t.get("Amount_USD") or 0)
            totals[f"{typ}_uzs"] += uzs
            totals[f"{typ}_usd"] += usd
            totals[f"{typ}_count"] += 1

            cat_key = (typ, t.get("Category", ""))
            cat = by_category.setdefault(cat_key, {"type": typ, "category": t.get("Category", ""),
                                                   "total_uzs": 0.0, "count": 0, "subcategories": {}})
            cat["total_uzs"] += uzs
            cat["count"] += 1
            sub = t.get("Subcategory", "") or "—"
            cat["subcategories"][sub] = cat["subcategories"].get(sub, 0.0) + uzs

            day = t.get("Date", "")
            drec = daily.setdefault(day, {"date": day, "income_uzs": 0.0, "expense_uzs": 0.0})
            drec[f"{typ}_uzs"] += uzs

        cats = sorted(by_category.values(), key=lambda c: -c["total_uzs"])
        for c in cats:
            c["subcategories"] = [
                {"subcategory": k, "total_uzs": v}
                for k, v in sorted(c["subcategories"].items(), key=lambda kv: -kv[1])
            ]

        def daily_sort_key(d):
            try:
                return dt.strptime(d["date"], "%d.%m.%Y")
            except ValueError:
                return dt.min
        days = sorted(daily.values(), key=daily_sort_key)

        return jsonify({
            "period": period,
            "totals": {**totals, "net_uzs": totals["income_uzs"] - totals["expense_uzs"]},
            "by_category": cats,
            "daily": days,
            "available_months": available_months,
        })
    except Exception as e:
        logger.error("analytics_summary error: %s", e)
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
