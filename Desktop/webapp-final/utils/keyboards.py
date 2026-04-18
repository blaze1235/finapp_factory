"""utils/keyboards.py — Inline and reply keyboards."""

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, KeyboardButton
from utils.sheets import get_categories


def main_menu_reply_keyboard(role: str) -> ReplyKeyboardMarkup:
    """Persistent bottom reply keyboard."""
    buttons = []
    if role in ("editor", "finance_director"):
        buttons.append([
            KeyboardButton("➕ Доход"),
            KeyboardButton("➖ Расход"),
        ])
    buttons.append([
        KeyboardButton("📊 Отчёт"),
        KeyboardButton("💰 Баланс"),
    ])
    return ReplyKeyboardMarkup(buttons, resize_keyboard=True)


def main_menu_keyboard(role: str) -> InlineKeyboardMarkup:
    buttons = []
    if role in ("editor", "finance_director"):
        buttons.append([
            InlineKeyboardButton("➕ Доход", callback_data="add_income"),
            InlineKeyboardButton("➖ Расход", callback_data="add_expense"),
        ])
    buttons.append([InlineKeyboardButton("📊 Отчёт", callback_data="report_prompt")])
    buttons.append([InlineKeyboardButton("💰 Баланс", callback_data="show_balance")])
    return InlineKeyboardMarkup(buttons)


def category_keyboard(type_: str) -> InlineKeyboardMarkup:
    cats = get_categories(type_)
    rows = []
    for i in range(0, len(cats), 2):
        row = [InlineKeyboardButton(cats[i], callback_data=f"cat_{type_}_{i}")]
        if i + 1 < len(cats):
            row.append(InlineKeyboardButton(cats[i+1], callback_data=f"cat_{type_}_{i+1}"))
        rows.append(row)
    rows.append([InlineKeyboardButton("✖ Отменить / Bekor", callback_data="cancel")])
    return InlineKeyboardMarkup(rows)


def get_category_by_index(type_: str, index: int) -> str:
    cats = get_categories(type_)
    return cats[index] if 0 <= index < len(cats) else ""


def confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Подтвердить", callback_data="confirm_tx"),
        InlineKeyboardButton("✖ Отменить", callback_data="cancel"),
    ]])


def period_dates_keyboard(dates_data: list[dict]) -> InlineKeyboardMarkup:
    rows = []
    for d in dates_data:
        label = f"📅 {d['date_str']}  +{_short(d['income'])}  -{_short(d['expense'])}"
        rows.append([InlineKeyboardButton(label, callback_data=f"day_{d['date_str']}")])
    rows.append([InlineKeyboardButton("✖ Закрыть", callback_data="cancel_report")])
    return InlineKeyboardMarkup(rows)


def _short(amount: float) -> str:
    if amount >= 1_000_000:
        return f"{amount/1_000_000:.1f}M"
    if amount >= 1_000:
        return f"{amount/1_000:.0f}K"
    return str(int(amount))
