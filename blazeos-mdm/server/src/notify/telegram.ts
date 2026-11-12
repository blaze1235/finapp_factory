import type { Notifier, NotifyTarget } from "./provider.js";

// Sends messages through the Telegram Bot API.
// Create a bot via @BotFather, put its token in TELEGRAM_BOT_TOKEN.
// Buyers/stores obtain a chat id by messaging the bot once (capture it from
// the getUpdates webhook) — stored on Buyer.telegramChatId / Store.telegramChatId.
export class TelegramNotifier implements Notifier {
  readonly name = "telegram";

  constructor(private readonly botToken: string) {
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is not set. Use NOTIFY_PROVIDER=mock for local dev.");
    }
  }

  async send(target: NotifyTarget, text: string): Promise<boolean> {
    if (!target.telegramChatId) return false;
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: target.telegramChatId, text, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[notify:telegram] failed for ${target.label}: ${res.status} ${body}`);
      return false;
    }
    return true;
  }
}
