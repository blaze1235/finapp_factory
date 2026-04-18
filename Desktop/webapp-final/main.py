"""main.py — FinApp Factory Bot + WebApp API entry point."""

import os
import logging
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    ContextTypes, MessageHandler, filters
)
from utils.sheets import get_user_role
from utils.keyboards import main_menu_reply_keyboard
from handlers.transaction import get_transaction_handler
from handlers.report import report_command, get_report_callbacks
from handlers.edit import get_edit_handler, get_edit_callbacks, receive_new_value, receive_new_date
from handlers.draft import get_draft_handlers, handle_draft_message
from utils.reports import get_balance_details, format_balance_message

load_dotenv()
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)


async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    role = get_user_role(user.id)
    if not role:
        await update.message.reply_text(
            "⛔ У вас нет доступа к этому боту.\n"
            "Обратитесь к администратору.\n\n"
            "⛔ Sizda bu botga kirish huquqi yo'q.\n"
            "Administrator bilan bog'laning."
        )
        return
    name = user.first_name or user.username or "пользователь"
    role_labels = {
        "editor": "Редактор / Muharrir",
        "director": "Директор / Direktor",
        "finance_director": "Фин. директор / Moliya direktori",
    }
    webapp_url = os.environ.get("WEBAPP_URL", "")
    webapp_btn = ""
    if webapp_url:
        from telegram import WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("🌐 Открыть WebApp", web_app=WebAppInfo(url=webapp_url))
        ]])
    else:
        keyboard = None

    await update.message.reply_text(
        f"👋 <b>{name}</b> | {role_labels.get(role, role)}\n\n"
        f"Используйте кнопки меню ниже.\n\n"
        f"<i>💡 Быстрый черновик: отправьте сумму и заметку\n"
        f"Пример: <code>700000 завод</code> или <code>$150 клиент</code></i>",
        reply_markup=main_menu_reply_keyboard(role),
        parse_mode="HTML"
    )
    if webapp_url and keyboard:
        await update.message.reply_text(
            "📱 Веб-интерфейс:",
            reply_markup=keyboard
        )


async def balance_command(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    try:
        bal = get_balance_details()
        text = format_balance_message(bal)
    except Exception as e:
        text = f"❌ Ошибка при получении баланса: {e}"
    await msg.reply_text(text, parse_mode="HTML")


async def reset_command(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data.clear()
    await update.message.reply_text("✅ Сброшено. Используйте кнопки меню.")


async def handle_report_balance(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if text == "📊 Отчёт":
        await report_command(update, ctx)
    elif text == "💰 Баланс":
        await balance_command(update, ctx)


async def handle_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    from handlers.report import _waiting_users, _process_period
    if ctx.user_data.get("edit_field"):
        field = ctx.user_data["edit_field"]
        if field == "Date":
            await receive_new_date(update, ctx)
        else:
            await receive_new_value(update, ctx)
        return
    user_id = update.effective_user.id
    if user_id in _waiting_users:
        _waiting_users.discard(user_id)
        await _process_period(update.message, ctx, update.message.text.strip())
        return
    await handle_draft_message(update, ctx)


def main():
    token = os.environ["BOT_TOKEN"]
    group_chat_id = os.environ.get("GROUP_CHAT_ID")

    # Start Flask API in background thread
    api_port = int(os.environ.get("PORT", 5000))
    from api.server import run_api
    run_api(port=api_port)

    app = Application.builder().token(token).build()
    if group_chat_id:
        app.bot_data["group_chat_id"] = int(group_chat_id)

    app.add_handler(get_transaction_handler())
    app.add_handler(get_edit_handler())
    for h in get_edit_callbacks():
        app.add_handler(h)
    for h in get_report_callbacks():
        app.add_handler(h)
    for h in get_draft_handlers():
        app.add_handler(h)

    app.add_handler(CommandHandler("start",   start))
    app.add_handler(CommandHandler("menu",    start))
    app.add_handler(CommandHandler("report",  report_command))
    app.add_handler(CommandHandler("balance", balance_command))
    app.add_handler(CommandHandler("reset",   reset_command))

    app.add_handler(MessageHandler(
        filters.TEXT & filters.Regex("^(📊 Отчёт|💰 Баланс)$"),
        handle_report_balance
    ))
    app.add_handler(MessageHandler(
        filters.TEXT & ~filters.COMMAND & ~filters.Regex("^(📊 Отчёт|💰 Баланс|➕ Доход|➖ Расход)$"),
        handle_text
    ))

    logger.info("✅ FinApp Factory Bot + WebApp API started.")
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)


if __name__ == "__main__":
    main()
