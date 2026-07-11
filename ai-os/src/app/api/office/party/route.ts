import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { startParty } from "@/server/office/simEngine";

const KINDS = new Set(["gather", "coffeebreak", "party"]);

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { kind } = await req.json().catch(() => ({}));
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }
  const party = startParty(kind as "gather" | "coffeebreak" | "party");
  return NextResponse.json({ ok: true, party });
}
