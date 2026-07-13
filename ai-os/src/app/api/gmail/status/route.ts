import { NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { isGmailConnected, oauthConfigured } from "@/server/gmail/client";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ connected: await isGmailConnected(), configured: oauthConfigured() });
}
