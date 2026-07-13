import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { exchangeCode } from "@/server/gmail/client";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.redirect(new URL("/login", process.env.APP_BASE_URL));
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const dest = new URL("/agents", process.env.APP_BASE_URL);
  if (error || !code) {
    dest.searchParams.set("gmail", "error");
    return NextResponse.redirect(dest);
  }
  try {
    await exchangeCode(code);
    dest.searchParams.set("gmail", "connected");
  } catch {
    dest.searchParams.set("gmail", "error");
  }
  return NextResponse.redirect(dest);
}
