import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-secret"),
  port: Number(process.env.PORT ?? 4000),
  mdmProvider: (process.env.MDM_PROVIDER ?? "mock") as "mock" | "nanomdm",
  nanomdm: {
    url: process.env.NANOMDM_URL ?? "",
    apiKey: process.env.NANOMDM_API_KEY ?? "",
  },
  // How many days past a due date before the system auto-locks.
  overdueGraceDays: Number(process.env.OVERDUE_GRACE_DAYS ?? 3),
  // Notifications: "mock" logs to console; "telegram" sends via the Bot API.
  notifyProvider: (process.env.NOTIFY_PROVIDER ?? "mock") as "mock" | "telegram",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
};
