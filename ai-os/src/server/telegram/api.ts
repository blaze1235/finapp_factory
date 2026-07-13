/** Thin Telegram Bot API client — plain fetch, no SDK needed for a bot this size. */

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export interface InlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export function botConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

async function call(method: string, payload: Record<string, unknown>) {
  if (!botConfigured()) return null;
  try {
    const res = await fetch(`${API()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) console.error(`telegram ${method} failed:`, JSON.stringify(data).slice(0, 200));
    return data;
  } catch (e) {
    console.error(`telegram ${method} error:`, String(e).slice(0, 200));
    return null;
  }
}

export async function sendMessage(chatId: number | string, text: string, buttons?: InlineButton[][]) {
  return call("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "Markdown",
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function answerCallback(callbackQueryId: string, text?: string) {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  buttons?: InlineButton[][],
) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4000),
    parse_mode: "Markdown",
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}
