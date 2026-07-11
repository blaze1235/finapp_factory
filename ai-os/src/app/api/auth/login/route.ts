import { NextRequest, NextResponse } from "next/server";
import { checkPassword, setSessionCookie } from "@/server/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || !checkPassword(password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  await setSessionCookie();
  return NextResponse.json({ ok: true });
}
