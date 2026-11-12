import { config } from "../config.js";
import { MockNotifier } from "./mock.js";
import { TelegramNotifier } from "./telegram.js";
import type { Notifier, NotifyTarget } from "./provider.js";

let instance: Notifier | null = null;

export function notifier(): Notifier {
  if (instance) return instance;
  instance =
    config.notifyProvider === "telegram"
      ? new TelegramNotifier(config.telegramBotToken)
      : new MockNotifier();
  return instance;
}

// Fire-and-forget: a notification failure must never break a lock/unlock.
export function notifySafe(target: NotifyTarget, text: string): void {
  notifier()
    .send(target, text)
    .catch((err) => console.error("[notify] error", err));
}

export type { NotifyTarget } from "./provider.js";
