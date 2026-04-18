"""handlers/draft.py — Quick draft logging and 1-hour completion reminder."""

from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CallbackQueryHandler
from utils.sheets import (
    log_transaction, get_user_role, fmt_amount,
    _get_sheet, TRANSACTION_HEADERS, delete_transaction
)
from utils.keyboards import get_category_by_index
import pytz

TZ = pytz.timezone("Asia/Tashkent")
DRAFT_CATEGORY = "ЧЕРНОВИК"
DRAFT_TYPE = "draft"


def _parse_draft(text: str):
    """
    Parses '700000 завод' or '$150 клиент' into (amount_uzs, amount_usd, is_usd, note).
    Returns None if text doesn't start with a number.
    """
    text = text.strip()
    parts = text.split(None, 1)
    if len(parts) != 2:
        return None
    amount_str, note = parts
    is_usd = amount_str.startswith("$")
    clean = amount_str.replace("$", "").replace(",", "").replace(" ", "")
    try:
        amount = float(clean)
    except ValueError:
        return None
    amount_uzs = amount  # for USD drafts, we store the raw amount; rate filled later
    amount_usd = amount if is_usd else 0.0
    return amount_uzs, amount_usd, is_usd, note.strip()


def _find_draft(tx_id: str):
    ws = _get_sheet().worksheet("Transactions")
    all_rows = ws.get_all_values()
    for i, row in enumerate(all_rows):
        if row and str(row[0]).upper() == tx_id.upper():
            padded = row + [""] * (len(TRANSACTION_HEADERS) - len(row))
            tx = {TRANSACTION_HEADERS[j]: padded[j] for j in range(len(TRANSACTION_HEADERS))}
            return i + 1, tx
    return None, None


def _update_draft(row: int, type_: str, category: str):
    ws = _get_sheet().worksheet("Transactions")
    type_col = TRANSACTION_HEADERS.index("Type") + 1
    cat_col = TRANSACTION_HEADERS.index("Category") + 1
    ws.update_cell(row, type_col, type_)
    ws.update_cell(row, cat_col, category)


def draft_type_keyboard(tx_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("▲ Доход",   callback_data=f"dr_type_{tx_id}_income"),
            InlineKeyboardButton("▼ Расход",  callback_data=f"dr_type_{tx_id}_expense"),
        ],
        [InlineKeyboardButton("🗑 Удалить черновик", callback_data=f"dr_delete_{tx_id}")],
    ])


def draft_cat_keyboard(tx_id: str, type_: str) -> InlineKeyboardMarkup:
    from utils.sheets import get_categories
    cats = get_categories(type_)
    rows = []
    for i in range(0, len(cats), 2):
        row = [InlineKeyboardButton(cats[i], callback_data=f"dr_cat_{tx_id}_{type_}_{i}")]
        if i + 1 < len(cats):
            row.append(InlineKeyboardButton(cats[i+1], callback_data=f"dr_cat_{tx_id}_{type_}_{i+1}"))
        rows.append(row)
    rows.append([InlineKeyboardButton("🔙 Назад", callback_data=f"dr_back_{tx_id}")])
    return InlineKeyboardMarkup(rows)


async def handle_draft_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Called from main.py handle_text when no other handler matched."""
    user = update.effective_user
    role = get_user_role(user.id)
    if role not in ("editor", "finance_director"):
        return

    parsed = _parse_draft(update.message.text)
    if not parsed:
        return  # not a draft format, silently ignore

    amount_uzs, amount_usd, is_usd, note = parsed
    currency = "USD" if is_usd else "UZS"
    date_str = datetime.now(TZ).strftime("%d.%m.%Y")

    tx = log_transaction(
        type_=DRAFT_TYPE,
        category=DRAFT_CATEGORY,
        amount_uzs=amount_uzs,
        note=note,
        editor_id=user.id,
        editor_name=user.full_name or user.username or str(user.id),
        amount_usd=amount_usd,
        currency=currency,
        tx_date=date_str,
    )

    if is_usd:
        amt_str = f"${amount_usd:,.2f}"
    else:
        amt_str = f"{int(amount_uzs):,}".replace(",", " ") + " сум"

    await update.message.reply_text(
        f"📝 <b>Черновик сохранён</b>\n\n"
        f"🆔 <code>{tx['id']}</code>\n"
        f"💰 {amt_str}\n"
        f"💬 {note}\n\n"
        f"⏰ Через 1 час напомню заполнить тип и категорию.",
        parse_mode="HTML"
    )

    # Schedule 1-hour reminder
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

    cat = get_category_by_index(type_, idx)
    if not cat:
        await query.edit_message_text("❌ Категория не найдена.")
        return

    row, tx = _find_draft(tx_id)
    if not tx:
        await query.edit_message_text("❌ Черновик не найден.")
        return

    _update_draft(row, type_, cat)

    # Cancel pending reminder
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

    await query.edit_message_text(
        f"✅ <b>Черновик завершён!</b>\n\n"
        f"🆔 <code>{tx_id}</code>\n"
        f"{icon} {type_label}\n"
        f"📂 {cat}\n"
        f"💬 {tx.get('Note', '')}\n"
        f"💰 {amt_str}",
        parse_mode="HTML"
    )


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
        CallbackQueryHandler(draft_back_callback,   pattern="^dr_back_"),
        CallbackQueryHandler(draft_delete_callback, pattern="^dr_delete_"),
    ]
