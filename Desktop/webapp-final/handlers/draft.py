"""handlers/draft.py — Quick log: a plain message like «700000 завод» or
«$150 клиент» instantly saves a draft; inline buttons let the user finish it
(type → category → subcategory) right away, with a 1-hour reminder fallback.
"""

import re
from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CallbackQueryHandler
from utils.sheets import (
    log_transaction, get_user_role, fmt_amount, get_categories, get_subcategories,
    _get_sheet, TRANSACTION_HEADERS, delete_transaction,
)
import pytz

TZ = pytz.timezone("Asia/Tashkent")
DRAFT_CATEGORY = "ЧЕРНОВИК"
DRAFT_TYPE = "draft"

# «700 000 завод», «1,500,000 клиент», «$150 клиент» — amount first, note after.
_DRAFT_RE = re.compile(r"^(\$?)(\d[\d\s.,]*)\s+(\D.+)$", re.DOTALL)


def _parse_draft(text: str):
    """Returns (amount, is_usd, note) or None if the message isn't a quick log."""
    text = text.strip()
    m = _DRAFT_RE.match(text)
    if m:
        dollar, amount_str, note = m.group(1), m.group(2), m.group(3)
    else:
        # Fallback: plain «<число> <заметка>» (note may start with a digit)
        parts = text.split(None, 1)
        if len(parts) != 2:
            return None
        amount_str, note = parts
        dollar = "$" if amount_str.startswith("$") else ""
        amount_str = amount_str.lstrip("$")
    clean = amount_str.replace(" ", "").replace(",", "")
    try:
        amount = float(clean)
    except ValueError:
        return None
    if amount <= 0:
        return None
    return amount, bool(dollar), note.strip()


def _find_draft(tx_id: str):
    ws = _get_sheet().worksheet("Transactions")
    all_rows = ws.get_all_values()
    for i, row in enumerate(all_rows):
        if row and str(row[0]).upper() == tx_id.upper():
            padded = row + [""] * (len(TRANSACTION_HEADERS) - len(row))
            tx = {TRANSACTION_HEADERS[j]: padded[j] for j in range(len(TRANSACTION_HEADERS))}
            return i + 1, tx
    return None, None


def _update_draft(row: int, type_: str, category: str, subcategory: str = ""):
    ws = _get_sheet().worksheet("Transactions")
    updates = {
        "Type": type_,
        "Category": category,
        "Subcategory": subcategory,
    }
    for field, value in updates.items():
        col = TRANSACTION_HEADERS.index(field) + 1
        ws.update_cell(row, col, value)


def draft_type_keyboard(tx_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("▲ Доход",   callback_data=f"dr_type_{tx_id}_income"),
            InlineKeyboardButton("▼ Расход",  callback_data=f"dr_type_{tx_id}_expense"),
        ],
        [InlineKeyboardButton("🗑 Удалить черновик", callback_data=f"dr_delete_{tx_id}")],
    ])


def draft_cat_keyboard(tx_id: str, type_: str) -> InlineKeyboardMarkup:
    cats = get_categories(type_)
    rows = []
    for i in range(0, len(cats), 2):
        row = [InlineKeyboardButton(cats[i], callback_data=f"dr_cat_{tx_id}_{type_}_{i}")]
        if i + 1 < len(cats):
            row.append(InlineKeyboardButton(cats[i+1], callback_data=f"dr_cat_{tx_id}_{type_}_{i+1}"))
        rows.append(row)
    rows.append([InlineKeyboardButton("🔙 Назад", callback_data=f"dr_back_{tx_id}")])
    return InlineKeyboardMarkup(rows)


def draft_sub_keyboard(tx_id: str, type_: str, cat_idx: int, subs: list[str]) -> InlineKeyboardMarkup:
    rows = []
    for i in range(0, len(subs), 2):
        row = [InlineKeyboardButton(subs[i], callback_data=f"dr_sub_{tx_id}_{type_}_{cat_idx}_{i}")]
        if i + 1 < len(subs):
            row.append(InlineKeyboardButton(subs[i+1], callback_data=f"dr_sub_{tx_id}_{type_}_{cat_idx}_{i+1}"))
        rows.append(row)
    rows.append([InlineKeyboardButton("⏭ Без подкатегории", callback_data=f"dr_sub_{tx_id}_{type_}_{cat_idx}_skip")])
    rows.append([InlineKeyboardButton("🔙 Назад", callback_data=f"dr_type_{tx_id}_{type_}")])
    return InlineKeyboardMarkup(rows)


async def handle_draft_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Called from main.py handle_text when no other handler matched."""
    user = update.effective_user
    role = get_user_role(user.id)
    if role not in ("editor", "finance_director"):
        return

    parsed = _parse_draft(update.message.text)
    if not parsed:
        return  # not a quick-log format, silently ignore

    amount, is_usd, note = parsed
    currency = "USD" if is_usd else "UZS"
    date_str = datetime.now(TZ).strftime("%d.%m.%Y")

    tx = log_transaction(
        type_=DRAFT_TYPE,
        category=DRAFT_CATEGORY,
        amount_uzs=amount,
        note=note,
        editor_id=user.id,
        editor_name=user.full_name or user.username or str(user.id),
        amount_usd=amount if is_usd else 0.0,
        currency=currency,
        tx_date=date_str,
    )

    if is_usd:
        amt_str = f"${amount:,.2f}"
    else:
        amt_str = f"{int(amount):,}".replace(",", " ") + " сум"

    # Categorize right away — no waiting for the reminder.
    await update.message.reply_text(
        f"📝 <b>Черновик сохранён</b>\n\n"
        f"🆔 <code>{tx['id']}</code>\n"
        f"💰 {amt_str}\n"
        f"💬 {note}\n\n"
        f"Укажите тип сейчас — или позже (напомню через час):",
        reply_markup=draft_type_keyboard(tx["id"]),
        parse_mode="HTML"
    )

    if ctx.job_queue:
        ctx.job_queue.run_once(
            _draft_reminder,
            when=3600,
            data={"tx_id": tx["id"], "user_id": user.id, "amt": amt_str, "note": note},
            name=f"draft_{tx['id']}",
        )


async def _draft_reminder(ctx: ContextTypes.DEFAULT_TYPE):
    data = ctx.job.data
    tx_id = data["tx_id"]
    user_id = data["user_id"]

    row, tx = _find_draft(tx_id)
    if not tx or tx.get("Type") != DRAFT_TYPE:
        return  # already completed or deleted

    try:
        await ctx.bot.send_message(
            user_id,
            f"⏰ <b>Незавершённый черновик!</b>\n\n"
            f"🆔 <code>{tx_id}</code>\n"
            f"💰 {data['amt']}\n"
            f"💬 {data['note']}\n\n"
            f"Укажите тип и категорию:",
            reply_markup=draft_type_keyboard(tx_id),
            parse_mode="HTML"
        )
    except Exception as e:
        print(f"Draft reminder error: {e}")


async def draft_type_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    # dr_type_{tx_id}_{type} — tx_id is 8 chars
    raw = query.data[len("dr_type_"):]
    tx_id = raw[:8]
    type_ = raw[9:]
    await query.edit_message_text(
        f"📂 <b>Выберите категорию:</b>",
        reply_markup=draft_cat_keyboard(tx_id, type_),
        parse_mode="HTML"
    )


async def _complete_draft(query, ctx, tx_id: str, type_: str, cat: str, sub: str):
    row, tx = _find_draft(tx_id)
    if not tx:
        await query.edit_message_text("❌ Черновик не найден.")
        return

    _update_draft(row, type_, cat, sub)

    if ctx.job_queue:
        for j in ctx.job_queue.get_jobs_by_name(f"draft_{tx_id}"):
            j.schedule_removal()

    icon = "▲" if type_ == "income" else "▼"
    type_label = "ДОХОД / KIRIM" if type_ == "income" else "РАСХОД / CHIQIM"
    try:
        amt_uzs = float(tx.get("Amount_UZS") or 0)
        amt_usd = float(tx.get("Amount_USD") or 0)
        amt_str = fmt_amount(amt_uzs, amt_usd, 0, tx.get("Currency", "UZS"))
    except Exception:
        amt_str = "—"
    cat_line = f"{cat} · {sub}" if sub else cat

    await query.edit_message_text(
        f"✅ <b>Черновик завершён!</b>\n\n"
        f"🆔 <code>{tx_id}</code>\n"
        f"{icon} {type_label}\n"
        f"📂 {cat_line}\n"
        f"💬 {tx.get('Note', '')}\n"
        f"💰 {amt_str}",
        parse_mode="HTML"
    )


async def draft_cat_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    # dr_cat_{tx_id}_{type}_{idx} — tx_id is 8 chars
    raw = query.data[len("dr_cat_"):]
    tx_id = raw[:8]
    rest = raw[9:]               # type_idx e.g. income_3
    parts = rest.rsplit("_", 1)
    type_ = parts[0]
    idx = int(parts[1])

    cats = get_categories(type_)
    cat = cats[idx] if 0 <= idx < len(cats) else ""
    if not cat:
        await query.edit_message_text("❌ Категория не найдена.")
        return

    subs = get_subcategories(type_, cat)
    if subs:
        await query.edit_message_text(
            f"📂 {cat}\n\n<b>Выберите подкатегорию:</b>",
            reply_markup=draft_sub_keyboard(tx_id, type_, idx, subs),
            parse_mode="HTML"
        )
        return

    await _complete_draft(query, ctx, tx_id, type_, cat, "")


async def draft_sub_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    # dr_sub_{tx_id}_{type}_{catIdx}_{subIdx|skip} — tx_id is 8 chars
    raw = query.data[len("dr_sub_"):]
    tx_id = raw[:8]
    rest = raw[9:]                       # income_3_1 | income_3_skip
    parts = rest.rsplit("_", 2)
    type_, cat_idx, sub_token = parts[0], int(parts[1]), parts[2]

    cats = get_categories(type_)
    cat = cats[cat_idx] if 0 <= cat_idx < len(cats) else ""
    if not cat:
        await query.edit_message_text("❌ Категория не найдена.")
        return

    sub = ""
    if sub_token != "skip":
        subs = get_subcategories(type_, cat)
        try:
            sub = subs[int(sub_token)]
        except (ValueError, IndexError):
            sub = ""

    await _complete_draft(query, ctx, tx_id, type_, cat, sub)


async def draft_back_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    tx_id = query.data[len("dr_back_"):]
    await query.edit_message_text(
        f"🆔 <code>{tx_id}</code>\n\nУкажите тип:",
        reply_markup=draft_type_keyboard(tx_id),
        parse_mode="HTML"
    )


async def draft_delete_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    tx_id = query.data[len("dr_delete_"):]
    if ctx.job_queue:
        for j in ctx.job_queue.get_jobs_by_name(f"draft_{tx_id}"):
            j.schedule_removal()
    success = delete_transaction(tx_id)
    if success:
        await query.edit_message_text(f"🗑 Черновик <code>{tx_id}</code> удалён.", parse_mode="HTML")
    else:
        await query.edit_message_text(f"❌ Черновик <code>{tx_id}</code> не найден.", parse_mode="HTML")


def get_draft_handlers():
    return [
        CallbackQueryHandler(draft_type_callback,   pattern="^dr_type_"),
        CallbackQueryHandler(draft_cat_callback,    pattern="^dr_cat_"),
        CallbackQueryHandler(draft_sub_callback,    pattern="^dr_sub_"),
        CallbackQueryHandler(draft_back_callback,   pattern="^dr_back_"),
        CallbackQueryHandler(draft_delete_callback, pattern="^dr_delete_"),
    ]
