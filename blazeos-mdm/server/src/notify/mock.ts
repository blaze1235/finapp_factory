import type { Notifier, NotifyTarget } from "./provider.js";

export class MockNotifier implements Notifier {
  readonly name = "mock";

  async send(target: NotifyTarget, text: string): Promise<boolean> {
    if (!target.telegramChatId) {
      console.log(`[notify:mock] skip ${target.label} (no chat id)`);
      return false;
    }
    console.log(`[notify:mock] → ${target.label} (${target.telegramChatId}): ${text}`);
    return true;
  }
}
