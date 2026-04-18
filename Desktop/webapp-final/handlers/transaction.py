"""handlers/transaction.py — Add income/expense conversation flow."""

from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, ConversationHandler, CommandHandler,
    CallbackQueryHandler, MessageHandler, filters
)
from utils.sheets import log_transaction, get_directors_and_finance, fmt_amount, get_user_role
from utils.keyboards import category_keyboard, get_category_by_index, confirm_keyboard
from utils.reports import format_transaction_notification, get_balance_details
import pytz

TZ = pytz.timezone("Asia/Tashkent")

CHOOSE_CATEGORY, CHOOSE_DATE, ENTER_AMOUNT, ENTER_NOTE, ENTER_USD_RATE, CONFIRM = range(6)


def cancel_button() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✖ Отменить / Bekor", callback_data="cancel")
    ]])


def date_keyboard() -> InlineKeyboardMarkup:
    today = datetime.now(TZ).strftime("%d.%m.%Y")
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(f"📅 Сегодня ({today})", callback_data=f"date_today_{today}")],
        [InlineKeyboardButton("✖ Отменить / Bekor", callback_data="cancel")],
    ])


async def _start_flow(update, ctx, type_: str, from_reply: bool):
    ctx.user_data["tx_type"] = type_
    ctx.user_data.pop("tx_category", None)
    icon = "➕" if type_ == "income" else "➖"
    label = "дохода / Kirim" if type_ == "income" else "расхода / Chiqim"
    kb = category_keyboard(type_)
    text = f"{icon} <b>Выберите категорию {label}:</b>"

    if from_reply:
        await update.message.reply_text(text, reply_markup=kb, parse_mode="HTML")
    else:
        await update.callback_query.edit_message_text(text, reply_markup=kb, parse_mode="HTML")
    return CHOOSE_CATEGORY


async def start_add_income(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()
    return await _start_flow(update, ctx, "income", from_reply=False)


async def start_add_expense(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()
    return await _start_flow(update, ctx, "expense", from_reply=False)


async def start_income_from_reply(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if get_user_role(user.id) not in ("editor", "finance_director"):
        return ConversationHandler.END
    return await _start_flow(update, ctx, "income", from_reply=True)


async def start_expense_from_reply(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if get_user_role(user.id) not in ("editor", "finance_director"):
        return ConversationHandler.END
    return await _start_flow(update, ctx, "expense", from_reply=True)


async def choose_category(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    parts = query.data.split("_")  # cat_income_3
    type_ = parts[1]
    idx = int(parts[2])
    cat = get_category_by_index(type_, idx)
    if not cat:
        await query.edit_message_text("❌ Категория не найдена. /start")
        return ConversationHandler.END

    ctx.user_data["tx_category"] = cat

    await query.edit_message_text(
        f"📅 <b>Дата транзакции / Sana:</b>\n\n"
        f"Нажмите «Сегодня» или введите вручную в формате <code>DD.MM.YYYY</code>",
        reply_markup=date_keyboard(),
        parse_mode="HTML"
    )
    return CHOOSE_DATE


async def choose_date_button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """User pressed the Today button."""
    query = update.callback_query
    await query.answer()
    date_str = query.data.replace("date_today_", "")
    ctx.user_data["tx_date"] = date_str
    await query.edit_message_text(
        f"📅 {date_str}\n\n"
        f"💰 Введите сумму / Summani kiriting:\n"
        f"<i>UZS: просто число (500000)\nUSD: добавьте $ ($150)</i>",
        reply_markup=cancel_button(),
        parse_mode="HTML"
    )
    return ENTER_AMOUNT


async def choose_date_manual(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """User typed a date manually."""
    text = update.message.text.strip()
    try:
        datetime.strptime(text, "%d.%m.%Y")
    except ValueError:
        await update.message.reply_text(
            "❌ Неверный формат. Введите дату как <code>DD.MM.YYYY</code> или нажмите кнопку:",
            reply_markup=date_keyboard(),
            parse_mode="HTML"
        )
        return CHOOSE_DATE

    ctx.user_data["tx_date"] = text
    await update.message.reply_text(
        f"📅 {text}\n\n"
        f"💰 Введите сумму / Summani kiriting:\n"
        f"<i>UZS: просто число (500000)\nUSD: добавьте $ ($150)</i>",
        reply_markup=cancel_button(),
        parse_mode="HTML"
    )
    return ENTER_AMOUNT


async def enter_amount(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip().replace(" ", "").replace(",", "")
    is_usd = "$" in text
    num_text = text.replace("$", "")

    try:
        amount = float(num_text)
    except ValueError:
        await update.message.reply_text(
            "❌ Неверный формат. Введите число (500000 или $150):",
            reply_markup=cancel_button()
        )
        return ENTER_AMOUNT

    ctx.user_data["raw_amount"] = amount
    ctx.user_data["is_usd"] = is_usd

    if is_usd:
        await update.message.reply_text(
            f"💵 Сумма: ${amount:,.2f}\n\nПо какому курсу? (напр. 12700):",
            reply_markup=cancel_button(),
            parse_mode="HTML"
        )
        return ENTER_USD_RATE

    ctx.user_data["amount_uzs"] = amount
    ctx.user_data["amount_usd"] = 0.0
    ctx.user_data["usd_rate"] = 0.0
    ctx.user_data["currency"] = "UZS"

    await update.message.reply_text(
        f"💰 Сумма: <b>{fmt_amount(amount)}</b>\n\n📝 Заметка / Izoh:",
        reply_markup=cancel_button(),
        parse_mode="HTML"
    )
    return ENTER_NOTE


async def enter_usd_rate(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip().replace(" ", "").replace(",", "")
    try:
        rate = float(text)
    except ValueError:
        await update.message.reply_text(
            "❌ Введите числовой курс (напр. 12700):",
            reply_markup=cancel_button()
        )
        return ENTER_USD_RATE

    usd = ctx.user_data["raw_amount"]
    uzs = usd * rate
    ctx.user_data["amount_usd"] = usd
    ctx.user_data["usd_rate"] = rate
    ctx.user_data["amount_uzs"] = uzs
    ctx.user_data["currency"] = "USD"

    await update.message.reply_text(
        f"💵 ${usd:,.2f} × {rate:,.0f} = <b>{fmt_amount(uzs)}</b>\n\n📝 Заметка / Izoh:",
        reply_markup=cancel_button(),
        parse_mode="HTML"
    )
    return ENTER_NOTE


async def enter_note(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    note = update.message.text.strip()
    if not note:
        await update.message.reply_text("📝 Заметка не может быть пустой:", reply_markup=cancel_button())
        return ENTER_NOTE

    ctx.user_data["note"] = note
    type_ = ctx.user_data["tx_type"]
    cat = ctx.user_data["tx_category"]
    date_str = ctx.user_data.get("tx_date", datetime.now(TZ).strftime("%d.%m.%Y"))
    amount_uzs = ctx.user_data["amount_uzs"]
    amount_usd = ctx.user_data.get("amount_usd", 0)
    usd_rate = ctx.user_data.get("usd_rate", 0)
    currency = ctx.user_data.get("currency", "UZS")

    icon = "▲" if type_ == "income" else "▼"
    type_label = "ДОХОД / KIRIM" if type_ == "income" else "РАСХОД / CHIQIM"
    amt_str = fmt_amount(amount_uzs, amount_usd, usd_rate, currency)

    preview = (
        f"{icon} <b>{type_label}</b>\n"
        f"📂 {cat}\n"
        f"📅 {date_str}\n"
        f"💬 {note}\n"
        f"💰 {amt_str}\n\n"
        f"<b>Подтвердить? / Tasdiqlaysizmi?</b>"
    )
    await update.message.reply_text(preview, reply_markup=confirm_keyboard(), parse_mode="HTML")
    return CONFIRM


async def confirm_transaction(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user = query.from_user
    editor_name = user.full_name or user.username or str(user.id)
    tx_date = ctx.user_data.get("tx_date", datetime.now(TZ).strftime("%d.%m.%Y"))

    tx = log_transaction(
        type_=ctx.user_data["tx_type"],
        category=ctx.user_data["tx_category"],
        amount_uzs=ctx.user_data["amount_uzs"],
        note=ctx.user_data["note"],
        editor_id=user.id,
        editor_name=editor_name,
        amount_usd=ctx.user_data.get("amount_usd", 0),
        usd_rate=ctx.user_data.get("usd_rate", 0),
        currency=ctx.user_data.get("currency", "UZS"),
        tx_date=tx_date,
    )

    try:
        bal = get_balance_details()
        total = bal["total_uzs"]
        cash_uzs = bal["cash_uzs"]
        cash_usd = bal["cash_usd"]
        cash_usd_uzs = bal.get("cash_usd_uzs", 0.0)

        t_icon = "💚" if total >= 0 else "🔴"
        t_sign = "+" if total >= 0 else "-"
        t_str = f"{int(abs(total)):,}".replace(",", " ") + " сум"
        uzs_sign = "+" if cash_uzs >= 0 else "-"
        uzs_str = f"{int(abs(cash_uzs)):,}".replace(",", " ") + " сум"
        usd_sign = "+" if cash_usd >= 0 else "-"
        usd_str = f"${abs(cash_usd):,.2f}"
        if cash_usd_uzs:
            usd_eq = f"{int(abs(cash_usd_uzs)):,}".replace(",", " ") + " сум"
            usd_str += f" ({usd_eq})"

        bal_line = (
            f"\n\n{t_icon} <b>Баланс:</b> {t_sign}{t_str}\n"
            f"  💵 UZS: {uzs_sign}{uzs_str}\n"
            f"  💵 USD: {usd_sign}{usd_str}"
        )
    except Exception as e:
        bal_line = f"\n\n⚠️ Баланс недоступен: {e}"

    notif = format_transaction_notification(tx)
    full_text = f"🔔 <b>Новая транзакция:</b>\n\n{notif}{bal_line}"

    edit_kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("✏️ Редактировать / Tahrirlash", callback_data=f"edit_tx_{tx['id']}")
    ]])

    group_id = ctx.bot_data.get("group_chat_id")
    if group_id:
        try:
            await ctx.bot.send_message(group_id, full_text, reply_markup=edit_kb, parse_mode="HTML")
        except Exception as e:
            print(f"Group notify error: {e}")

    for did in get_directors_and_finance():
        if did != user.id:
            try:
                await ctx.bot.send_message(did, full_text, reply_markup=edit_kb, parse_mode="HTML")
            except Exception as e:
                print(f"DM notify error: {e}")

    await query.edit_message_text(
        f"✅ <b>Записано!</b>\n\n{notif}{bal_line}",
        reply_markup=edit_kb,
        parse_mode="HTML"
    )
    ctx.user_data.clear()
    return ConversationHandler.END


async def cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data.clear()
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text("❌ Отменено / Bekor qilindi.")
    else:
        await update.message.reply_text("❌ Отменено / Bekor qilindi.")
    return ConversationHandler.END


def get_transaction_handler() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[
            CallbackQueryHandler(start_add_income,       pattern="^add_income$"),
            CallbackQueryHandler(start_add_expense,      pattern="^add_expense$"),
            MessageHandler(filters.Regex("^➕ Доход$"),  start_income_from_reply),
            MessageHandler(filters.Regex("^➖ Расход$"), start_expense_from_reply),
        ],
        states={
            CHOOSE_CATEGORY: [CallbackQueryHandler(choose_category, pattern="^cat_")],
            CHOOSE_DATE: [
                CallbackQueryHandler(choose_date_button, pattern="^date_today_"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, choose_date_manual),
            ],
            ENTER_AMOUNT:   [MessageHandler(filters.TEXT & ~filters.COMMAND, enter_amount)],
            ENTER_USD_RATE: [MessageHandler(filters.TEXT & ~filters.COMMAND, enter_usd_rate)],
            ENTER_NOTE:     [MessageHandler(filters.TEXT & ~filters.COMMAND, enter_note)],
            CONFIRM: [
                CallbackQueryHandler(confirm_transaction, pattern="^confirm_tx$"),
                CallbackQueryHandler(cancel, pattern="^cancel$"),
            ],
        },
        fallbacks=[
            CallbackQueryHandler(cancel, pattern="^cancel$"),
            CommandHandler("cancel", cancel),
            MessageHandler(filters.Regex("^➕ Доход$"),  start_income_from_reply),
            MessageHandler(filters.Regex("^➖ Расход$"), start_expense_from_reply),
        ],
        per_message=False,
        allow_reentry=True,
    )
