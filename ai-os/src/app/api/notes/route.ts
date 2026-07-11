import { NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";

/** Deliverable notes for the Brain Net graph. */
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const notes = await sql`SELECT id, title, department, result, created_at FROM tasks
                          WHERE result IS NOT NULL ORDER BY created_at DESC LIMIT 200`;
  return NextResponse.json({ notes });
}
