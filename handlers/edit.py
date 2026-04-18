"""handlers/edit.py — Edit a transaction (inline button or /edit command)."""

from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, ConversationHandler, CommandHandler,
    CallbackQueryHandler, MessageHandler, filters
)
from utils.sheets import get_user_role, _get_sheet

WAIT_ID, WAIT_FIELD, WAIT_VALUE, WAIT_DATE = range(20, 24)

TZ_FMT = "%d.%m.%Y"


def find_transaction(tx_id: str):
    sh = _get_sheet()
    ws = sh.worksheet("Transactions")
    records = ws.get_all_records()
    for i, r in enumerate(records):
        if str(r.get("ID", "")).upper() == tx_id.upper():
            return i + 2, r
    return None, None


def update_cell(row: int, field: str, value: str):
    sh = _get_sheet()
    ws = sh.worksheet("Transactions")
    headers = ws.row_values(1)
    if field not in headers:
        return False
    col = headers.index(field) + 1
    ws.update_cell(row, col, value)
    return True


def field_select_keyboard(tx_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📂 Категория", callback_data=f"editf_{tx_id}_Category")],
        [InlineKeyboardButton("💬 Заметка",   callback_data=f"editf_{tx_id}_Note")],
        [InlineKeyboardButton("💰 Сумма (UZS)", callback_data=f"editf_{tx_id}_Amount_UZS")],
        [InlineKeyboardButton("📅 Дата",       callback_data=f"editf_{tx_id}_Date")],
        [InlineKeyboardButton("✖ Отменить / Bekor", callback_data="edit_cancel")],
    ])


def _tx_preview(tx: dict, tx_id: str) -> str:
    return (
        f"✏️ <b>Редактирование {tx_id}</b>\n\n"
        f"📂 {tx.get('Category', '—')}\n"
        f"💬 {tx.get('Note', '—')}\n"
        f"💰 {tx.get('Amount_UZS', '—')} сум\n"
        f"📅 {tx.get('Date', '—')}\n\n"
        f"Что изменить? / Nima o'zgartirish?"
    )


async def edit_inline_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Triggered when user presses ✏️ button under a cheque."""
    query = update.callback_query
    await query.answer()
    user = query.from_user
    role = get_user_role(user.id)
    if role not in ("editor", "finance_director"):
        await query.answer("⛔ Нет доступа.", show_alert=True)
        return

    tx_id = query.data.replace("edit_tx_", "")
    row, tx = find_transaction(tx_id)
    if not tx:
        await query.answer("❌ Транзакция не найдена.", show_alert=True)
        return

    ctx.user_data["edit_row"] = row
    ctx.user_data["edit_tx"] = tx
    ctx.user_data["edit_tx_id"] = tx_id

    await query.message.reply_text(
        _tx_preview(tx, tx_id),
        reply_markup=field_select_keyboard(tx_id),
        parse_mode="HTML"
    )


async def edit_field_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """User selected which field to edit."""
    query = update.callback_query
    await query.answer()

    # editf_{tx_id}_{field}  — field may contain underscores (Amount_UZS)
    raw = query.data  # e.g. editf_A1B2C3D4_Amount_UZS
    prefix = "editf_"
    without_prefix = raw[len(prefix):]          # A1B2C3D4_Amount_UZS
    tx_id = without_prefix[:8]                  # A1B2C3D4
    field = without_prefix[9:]                  # Amount_UZS  (skip the underscore after ID)

    field_labels = {
        "Category":   "Категория",
        "Note":       "Заметка",
        "Amount_UZS": "Сумма (UZS)",
        "Date":       "Дата",
    }
    label = field_labels.get(field, field)

    # Load tx if not in user_data
    if ctx.user_data.get("edit_tx_id") != tx_id:
        row, tx = find_transaction(tx_id)
        ctx.user_data["edit_row"] = row
        ctx.user_data["edit_tx"] = tx
        ctx.user_data["edit_tx_id"] = tx_id

    current = ctx.user_data.get("edit_tx", {}).get(field, "")
    ctx.user_data["edit_field"] = field
    ctx.user_data["edit_label"] = label

    cancel_kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("✖ Отменить / Bekor", callback_data="edit_cancel")
    ]])

    if field == "Date":
        await query.edit_message_text(
            f"📅 <b>Дата</b>\n\nТекущая: <code>{current}</code>\n\n"
            f"Введите новую дату в формате <code>DD.MM.YYYY</code>:",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        return WAIT_DATE
    else:
        await query.edit_message_text(
            f"✏️ <b>{label}</b>\n\nТекущее: <code>{current}</code>\n\nВведите новое значение:",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        return WAIT_VALUE


async def receive_new_date(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    try:
        datetime.strptime(text, TZ_FMT)
    except ValueError:
        await update.message.reply_text(
            "❌ Неверный формат. Введите дату как <code>DD.MM.YYYY</code> (напр. 07.04.2026):",
            parse_mode="HTML"
        )
        return WAIT_DATE

    row = ctx.user_data.get("edit_row")
    if not row:
        await update.message.reply_text("⚠️ Сессия истекла. Нажмите ✏️ снова.")
        return ConversationHandler.END

    # Update both Date and Timestamp date part
    success = update_cell(row, "Date", text)
    # Also update date part in Timestamp if it exists
    tx = ctx.user_data.get("edit_tx", {})
    ts = str(tx.get("Timestamp", ""))
    if ts and len(ts) >= 10:
        time_part = ts[10:]  # " HH:MM:SS"
        new_ts = text + time_part
        update_cell(row, "Timestamp", new_ts)

    if success:
        await update.message.reply_text(
            f"✅ <b>Дата</b> обновлена: <code>{text}</code>",
            parse_mode="HTML"
        )
    else:
        await update.message.reply_text("❌ Ошибка при обновлении.")

    ctx.user_data.clear()
    return ConversationHandler.END


async def receive_new_value(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    value = update.message.text.strip()
    row = ctx.user_data.get("edit_row")
    field = ctx.user_data.get("edit_field")
    label = ctx.user_data.get("edit_label")

    if not row or not field:
        await update.message.reply_text("⚠️ Сессия истекла. Нажмите ✏️ снова.")
        return ConversationHandler.END

    success = update_cell(row, field, value)

    if success:
        await update.message.reply_text(
            f"✅ <b>{label}</b> обновлено: <code>{value}</code>",
            parse_mode="HTML"
        )
    else:
        await update.message.reply_text("❌ Ошибка при обновлении.")

    ctx.user_data.clear()
    return ConversationHandler.END


async def edit_cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("❌ Редактирование отменено / Tahrirlash bekor qilindi.")
    ctx.user_data.clear()
    return ConversationHandler.END


async def edit_command(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/edit command — ask for TX ID manually."""
    user = update.effective_user
    role = get_user_role(user.id)
    if role not in ("editor", "finance_director"):
        await update.message.reply_text("⛔ Нет доступа.")
        return ConversationHandler.END

    await update.message.reply_text(
        "✏️ Введите ID транзакции (напр. <code>A1B2C3D4</code>):",
        parse_mode="HTML"
    )
    return WAIT_ID


async def receive_id(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    tx_id = update.message.text.strip().upper()
    row, tx = find_transaction(tx_id)
    if not tx:
        await update.message.reply_text(
            f"❌ Транзакция <code>{tx_id}</code> не найдена.",
            parse_mode="HTML"
        )
        return ConversationHandler.END

    ctx.user_data["edit_row"] = row
    ctx.user_data["edit_tx"] = tx
    ctx.user_data["edit_tx_id"] = tx_id

    await update.message.reply_text(
        _tx_preview(tx, tx_id),
        reply_markup=field_select_keyboard(tx_id),
        parse_mode="HTML"
    )
    return WAIT_FIELD


def get_edit_handler() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CommandHandler("edit", edit_command)],
        states={
            WAIT_ID:    [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_id)],
            WAIT_FIELD: [CallbackQueryHandler(edit_field_callback, pattern="^editf_")],
            WAIT_VALUE: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_new_value)],
            WAIT_DATE:  [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_new_date)],
        },
        fallbacks=[
            CallbackQueryHandler(edit_cancel, pattern="^edit_cancel$"),
            CommandHandler("cancel", edit_cancel),
        ],
        per_message=False,
        per_chat=False,
        per_user=True,
        allow_reentry=True,
    )


def get_edit_callbacks() -> list:
    """Standalone callbacks for inline ✏️ button flow."""
    return [
        CallbackQueryHandler(edit_inline_callback, pattern="^edit_tx_"),
        CallbackQueryHandler(edit_field_callback,  pattern="^editf_"),
        CallbackQueryHandler(edit_cancel,           pattern="^edit_cancel$"),
    ]
