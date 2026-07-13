import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { handleUpdate } from "@/server/telegram/handlers";

/** Public endpoint — authenticated by Telegram's secret token header, not the app session. */
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const update = await req.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });
  // ack Telegram immediately; process (and possibly run a whole task) afterwards
  after(() => handleUpdate(update).catch((e) => console.error("tg update failed:", String(e).slice(0, 300))));
  return NextResponse.json({ ok: true });
}
