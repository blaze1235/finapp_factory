import { NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { isConfigured } from "@/server/datasources/connector";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    blazerent: isConfigured("blazerent"),
    finly: isConfigured("finly"),
    bika: isConfigured("bika"),
  });
}
