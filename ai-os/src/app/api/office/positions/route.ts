import { NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { snapshot, partyStatus } from "@/server/office/simEngine";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ positions: snapshot(), party: partyStatus() });
}
