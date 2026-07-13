import { NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { oauthConfigured, authUrl } from "@/server/gmail/client";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.redirect(new URL("/login", process.env.APP_BASE_URL));
  if (!oauthConfigured()) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID/SECRET or APP_BASE_URL not set" }, { status: 500 });
  }
  return NextResponse.redirect(authUrl());
}
