"""utils/reports.py — Report generation and balance logic."""

from datetime import date, datetime
from collections import defaultdict
from utils.sheets import get_transactions_by_date_range, get_all_transactions, fmt_amount


def parse_date_range(text: str):
    text = text.strip()
    parts = text.split("-")
    if len(parts) != 2:
        raise ValueError("bad_format")
    d1 = datetime.strptime(parts[0].strip(), "%d.%m.%Y").date()
    d2 = datetime.strptime(parts[1].strip(), "%d.%m.%Y").date()
    if d1 > d2:
        d1, d2 = d2, d1
    return d1, d2


def get_balance_details() -> dict:
    """
    Calculates balance from raw transaction log.

    Total UZS  = sum of all Amount_UZS (income) - sum of all Amount_UZS (expense)
                 Amount_UZS already has the exact rate baked in at logging time,
                 so $10 @ 12000 = 120,000 сум and $10 @ 12100 = 121,000 сум → 241,000 сум total.

    UZS in safe = net of UZS-only transactions
    USD in safe = net raw USD amount
    USD→UZS eq  = net of Amount_UZS for USD transactions (exact rates, not estimated)
    """
    records = get_all_transactions()

    total_uzs = 0.0      # grand total in UZS (all transactions)
    cash_uzs = 0.0       # UZS-only transactions net
    cash_usd = 0.0       # USD net (raw dollars)
    cash_usd_uzs = 0.0   # UZS equivalent of USD transactions (exact logged rates)

    for r in records:
        try:
            amount_uzs = float(r.get("Amount_UZS", 0) or 0)
        except (ValueError, TypeError):
            amount_uzs = 0.0
        try:
            amount_usd = float(r.get("Amount_USD", 0) or 0)
        except (ValueError, TypeError):
            amount_usd = 0.0

        currency = str(r.get("Currency", "UZS")).strip().upper()
        t = r.get("Type", "")

        if t == "income":
            total_uzs += amount_uzs
            if currency == "USD":
                cash_usd += amount_usd
                cash_usd_uzs += amount_uzs   # e.g. 120,000 for $10@12000
            else:
                cash_uzs += amount_uzs
        elif t == "expense":
            total_uzs -= amount_uzs
            if currency == "USD":
                cash_usd -= amount_usd
                cash_usd_uzs -= amount_uzs
            else:
                cash_uzs -= amount_uzs

    return {
        "total_uzs": total_uzs,
        "cash_uzs": cash_uzs,
        "cash_usd": cash_usd,
        "cash_usd_uzs": cash_usd_uzs,
    }


def _fmt(amount: float, suffix: str = " сум") -> str:
    sign = "+" if amount >= 0 else "-"
    val = f"{int(abs(amount)):,}".replace(",", " ")
    return f"{sign}{val}{suffix}"


def format_balance_message(bal: dict) -> str:
    total = bal["total_uzs"]
    cash_uzs = bal["cash_uzs"]
    cash_usd = bal["cash_usd"]
    cash_usd_uzs = bal["cash_usd_uzs"]

    total_icon = "🟰" if total >= 0 else "🔴"
    uzs_icon = "💵" if cash_uzs >= 0 else "🔴"
    usd_icon = "💵" if cash_usd >= 0 else "🔴"

    # Total line
    total_str = _fmt(total)

    # UZS safe line
    uzs_str = _fmt(cash_uzs)

    # USD line: raw dollars + UZS equivalent in brackets
    usd_sign = "+" if cash_usd >= 0 else "-"
    usd_str = f"{usd_sign}${abs(cash_usd):,.2f}"
    uzs_eq = f"{int(abs(cash_usd_uzs)):,}".replace(",", " ") + " сум"
    usd_full = f"{usd_str} ({uzs_eq})"

    lines = [
        "💰 <b>Текущий баланс / Joriy balans</b>",
        "",
        f"{total_icon} <b>Всего / Jami:</b> {total_str}",
        "",
        "📂 <b>В сейфе / Seifda:</b>",
        f"  {uzs_icon} UZS: {uzs_str}",
        f"  {usd_icon} USD: {usd_full}",
    ]
    return "\n".join(lines)


def get_running_balance() -> float:
    return get_balance_details()["total_uzs"]


def build_period_summary(date_from: date, date_to: date) -> dict:
    txs = get_transactions_by_date_range(date_from, date_to)

    by_date = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    income_by_cat = defaultdict(float)
    expense_by_cat = defaultdict(float)
    total_income = 0.0
    total_expense = 0.0

    for tx in txs:
        d = tx.get("Date", "")
        cat = tx.get("Category", "—")
        try:
            amount = float(tx.get("Amount_UZS", 0) or 0)
        except (ValueError, TypeError):
            amount = 0.0
        t = tx.get("Type", "")
        if t == "income":
            by_date[d]["income"] += amount
            total_income += amount
            income_by_cat[cat] += amount
        elif t == "expense":
            by_date[d]["expense"] += amount
            total_expense += amount
            expense_by_cat[cat] += amount

    sorted_dates = sorted(by_date.keys(), key=lambda d: datetime.strptime(d, "%d.%m.%Y"))

    running = 0.0
    dates_list = []
    for d_str in sorted_dates:
        inc = by_date[d_str]["income"]
        exp = by_date[d_str]["expense"]
        running += inc - exp
        dates_list.append({
            "date_str": d_str,
            "income": inc,
            "expense": exp,
            "balance": running,
        })

    return {
        "dates": dates_list,
        "total_income": total_income,
        "total_expense": total_expense,
        "running_balance": total_income - total_expense,
        "transactions": txs,
        "income_by_category": dict(sorted(income_by_cat.items(), key=lambda x: -x[1])),
        "expense_by_category": dict(sorted(expense_by_cat.items(), key=lambda x: -x[1])),
    }


def build_day_detail(date_str: str, txs: list[dict]) -> dict:
    day_txs = [t for t in txs if t.get("Date") == date_str]
    income = defaultdict(list)
    expense = defaultdict(list)
    total_income = 0.0
    total_expense = 0.0

    for tx in day_txs:
        cat = tx.get("Category", "—")
        try:
            amount = float(tx.get("Amount_UZS", 0) or 0)
        except (ValueError, TypeError):
            amount = 0.0
        try:
            amount_usd = float(tx.get("Amount_USD", 0) or 0)
        except (ValueError, TypeError):
            amount_usd = 0.0
        entry = {
            "note": tx.get("Note", ""),
            "amount_uzs": amount,
            "amount_usd": amount_usd,
            "currency": tx.get("Currency", "UZS"),
            "usd_rate": tx.get("USD_Rate", 0),
            "time": tx.get("Timestamp", "")[-8:] if tx.get("Timestamp") else "",
        }
        if tx.get("Type") == "income":
            income[cat].append(entry)
            total_income += amount
        elif tx.get("Type") == "expense":
            expense[cat].append(entry)
            total_expense += amount

    return {
        "income": dict(income),
        "expense": dict(expense),
        "total_income": total_income,
        "total_expense": total_expense,
        "day_balance": total_income - total_expense,
    }


def format_period_header(summary: dict, date_from: date, date_to: date) -> str:
    d1 = date_from.strftime("%d.%m.%Y")
    d2 = date_to.strftime("%d.%m.%Y")
    inc = fmt_amount(summary["total_income"])
    exp = fmt_amount(summary["total_expense"])
    bal = fmt_amount(abs(summary["running_balance"]))
    sign = "+" if summary["running_balance"] >= 0 else "-"
    icon = "🟰" if summary["running_balance"] >= 0 else "🔴"

    lines = [
        f"📊 <b>Отчёт / Hisobot</b>",
        f"📅 {d1} — {d2}",
        "",
        f"▲ <b>Доход / Kirim:</b> {inc}",
        f"▼ <b>Расход / Chiqim:</b> {exp}",
        f"{icon} <b>Итог / Natija:</b> {sign}{bal}",
    ]

    if summary.get("income_by_category"):
        lines.append("")
        lines.append("▲ <b>Доход по категориям:</b>")
        for cat, amount in summary["income_by_category"].items():
            lines.append(f"  • {cat}: {fmt_amount(amount)}")

    if summary.get("expense_by_category"):
        lines.append("")
        lines.append("▼ <b>Расход по категориям:</b>")
        for cat, amount in summary["expense_by_category"].items():
            lines.append(f"  • {cat}: {fmt_amount(amount)}")

    lines.append("")
    lines.append("<i>Нажмите на дату для деталей / Sana bosing:</i>")

    return "\n".join(lines)


def format_day_detail_text(date_str: str, detail: dict) -> str:
    lines = [f"📅 <b>{date_str}</b>\n"]

    if detail["income"]:
        lines.append("▲ <b>ДОХОД / KIRIM:</b>")
        for cat, entries in detail["income"].items():
            cat_total = sum(e["amount_uzs"] for e in entries)
            lines.append(f"  <b>{cat}</b> — {fmt_amount(cat_total)}")
            for e in entries:
                amt = fmt_amount(e["amount_uzs"], e["amount_usd"], e.get("usd_rate", 0), e["currency"])
                lines.append(f"    • {e['note']} | {amt}")
        lines.append("")

    if detail["expense"]:
        lines.append("▼ <b>РАСХОД / CHIQIM:</b>")
        for cat, entries in detail["expense"].items():
            cat_total = sum(e["amount_uzs"] for e in entries)
            lines.append(f"  <b>{cat}</b> — {fmt_amount(cat_total)}")
            for e in entries:
                amt = fmt_amount(e["amount_uzs"], e["amount_usd"], e.get("usd_rate", 0), e["currency"])
                lines.append(f"    • {e['note']} | {amt}")
        lines.append("")

    inc = fmt_amount(detail["total_income"])
    exp = fmt_amount(detail["total_expense"])
    bal = detail["day_balance"]
    bal_str = fmt_amount(abs(bal))
    sign = "+" if bal >= 0 else "-"
    icon = "🟰" if bal >= 0 else "🔴"

    lines.append(f"▲ Итог доход: {inc}")
    lines.append(f"▼ Итог расход: {exp}")
    lines.append(f"{icon} День: {sign}{bal_str}")

    return "\n".join(lines)


def format_transaction_notification(tx: dict) -> str:
    t = tx["type"]
    icon = "▲" if t == "income" else "▼"
    type_label = "ДОХОД / KIRIM" if t == "income" else "РАСХОД / CHIQIM"
    amt = fmt_amount(tx["amount_uzs"], tx.get("amount_usd", 0), tx.get("usd_rate", 0), tx.get("currency", "UZS"))

    return (
        f"🆔 {tx['id']}\n"
        f"{icon} <b>{type_label}</b>\n"
        f"📂 {tx['category']}\n"
        f"💬 {tx['note']}\n"
        f"💰 {amt}\n"
        f"🕐 {tx['timestamp']}"
    )
