"""handlers/report.py — /report command and interactive date navigation."""

from datetime import datetime, date, timedelta
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, ConversationHandler, CommandHandler,
    CallbackQueryHandler, MessageHandler, filters
)
from utils.reports import (
    parse_date_range, build_period_summary, build_day_detail,
    format_period_header, format_day_detail_text
)
from utils.keyboards import period_dates_keyboard
import pytz

TZ = pytz.timezone("Asia/Tashkent")
WAIT_PERIOD = 10
_waiting_users = set()


def quick_period_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📅 Сегодня",   callback_data="rq_today"),
            InlineKeyboardButton("📅 Неделя",    callback_data="rq_week"),
        ],
        [
            InlineKeyboardButton("📅 Месяц",     callback_data="rq_month"),
            InlineKeyboardButton("📅 Всё время", callback_data="rq_alltime"),
        ],
        [InlineKeyboardButton("✏️ Вручную",      callback_data="rq_manual")],
    ])


async def report_command(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Entry point from /report command or 📊 reply button."""
    args = ctx.args
    if args:
        await _process_period(update.message, ctx, args[0])
        return

    await update.message.reply_text(
        "📊 <b>Отчёт / Hisobot</b>\n\nВыберите период:",
        reply_markup=quick_period_keyboard(),
        parse_mode="HTML"
    )
    # Mark user as waiting for manual input (in case they type instead of pressing button)
    _waiting_users.add(update.effective_user.id)


async def quick_period_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Handles Today/Week/Month/All time/Manual buttons — standalone, no ConvHandler needed."""
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "rq_manual":
        _waiting_users.add(query.from_user.id)
        await query.edit_message_text(
            "✏️ Введите период:\n"
            "<code>DD.MM.YYYY-DD.MM.YYYY</code>\n\n"
            "<i>Пример: 01.04.2026-13.04.2026</i>",
            parse_mode="HTML"
        )
        return

    today = datetime.now(TZ).date()

    if data == "rq_today":
        date_from = date_to = today
    elif data == "rq_week":
        date_from = today - timedelta(days=6)
        date_to = today
    elif data == "rq_month":
        date_from = today.replace(day=1)
        date_to = today
    elif data == "rq_alltime":
        date_from = date(2000, 1, 1)
        date_to = today
    else:
        return

    await _process_period(query.message, ctx, None, date_from=date_from, date_to=date_to)


async def receive_period_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Catch manual date range text from users who are in _waiting_users."""
    user_id = update.effective_user.id
    if user_id not in _waiting_users:
        return
    if update.message.chat.type in ("group", "supergroup") and user_id not in _waiting_users:
        return
    _waiting_users.discard(user_id)
    await _process_period(update.message, ctx, update.message.text.strip())


async def _process_period(msg, ctx, text=None, date_from=None, date_to=None):
    if text is not None:
        try:
            date_from, date_to = parse_date_range(text)
        except ValueError:
            await msg.reply_text(
                "❌ Неверный формат.\nИспользуйте: <code>DD.MM.YYYY-DD.MM.YYYY</code>",
                parse_mode="HTML"
            )
            return

    summary = build_period_summary(date_from, date_to)
    if not summary["dates"]:
        await msg.reply_text("📭 Нет данных за этот период.")
        return

    ctx.user_data["report_summary"] = summary
    ctx.user_data["report_from"] = date_from
    ctx.user_data["report_to"] = date_to

    header = format_period_header(summary, date_from, date_to)
    kb = period_dates_keyboard(summary["dates"])
    await msg.reply_text(header, reply_markup=kb, parse_mode="HTML")


async def day_selected(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    date_str = query.data.replace("day_", "")
    summary = ctx.user_data.get("report_summary")
    if not summary:
        await query.message.reply_text("⚠️ Сессия истекла. Нажмите 📊 Отчёт заново.")
        return
    detail = build_day_detail(date_str, summary["transactions"])
    text = format_day_detail_text(date_str, detail)
    back_kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("🔙 Назад / Orqaga", callback_data="back_to_report")
    ]])
    await query.message.reply_text(text, reply_markup=back_kb, parse_mode="HTML")


async def back_to_report(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    summary = ctx.user_data.get("report_summary")
    date_from = ctx.user_data.get("report_from")
    date_to = ctx.user_data.get("report_to")
    if not summary:
        await query.message.reply_text("⚠️ Сессия истекла. Нажмите 📊 Отчёт заново.")
        return
    header = format_period_header(summary, date_from, date_to)
    kb = period_dates_keyboard(summary["dates"])
    await query.message.reply_text(header, reply_markup=kb, parse_mode="HTML")


async def cancel_report(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    ctx.user_data.pop("report_summary", None)
    await query.edit_message_text("📊 Отчёт закрыт.")


def get_report_handler():
    """No longer a ConversationHandler — everything is standalone callbacks."""
    return None  # handled in get_report_callbacks()


def get_report_callbacks():
    """All report-related standalone handlers."""
    return [
        CallbackQueryHandler(quick_period_callback, pattern="^rq_"),
        CallbackQueryHandler(day_selected,           pattern="^day_"),
        CallbackQueryHandler(back_to_report,         pattern="^back_to_report$"),
        CallbackQueryHandler(cancel_report,          pattern="^cancel_report$"),
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            receive_period_text
        ),
    ]


def get_day_handlers():
    return []  # now included in get_report_callbacks
