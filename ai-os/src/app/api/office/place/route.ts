import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { placeEveryone, freeEveryone } from "@/server/office/simEngine";

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mode } = await req.json().catch(() => ({}));
  if (mode === "place") placeEveryone();
  else if (mode === "free") freeEveryone();
  else return NextResponse.json({ error: "bad mode" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
