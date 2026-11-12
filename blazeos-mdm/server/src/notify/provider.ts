// Notification provider abstraction (same shape as the MDM provider).
//
// - MockNotifier: local dev. Logs messages, no network.
// - TelegramNotifier: production. Sends via the Telegram Bot API.
//
// Targets are addressed by their Telegram chat id. A buyer or store with no
// chat id is simply skipped (returns false), so missing contact info never
// breaks a lock/unlock.

export interface NotifyTarget {
  telegramChatId?: string | null;
  label: string; // for logging, e.g. "buyer Oybek" / "store Tashkent Mobile"
}

export interface Notifier {
  readonly name: string;
  /** Returns true if a message was sent, false if skipped (no chat id). */
  send(target: NotifyTarget, text: string): Promise<boolean>;
}
