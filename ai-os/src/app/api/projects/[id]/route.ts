import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { name, purpose, department } = await req.json().catch(() => ({}));

  await sql`
    UPDATE projects SET
      name = COALESCE(${typeof name === "string" ? name.trim().slice(0, 120) : null}, name),
      purpose = COALESCE(${typeof purpose === "string" ? purpose.slice(0, 4000) : null}, purpose),
      department = CASE WHEN ${department !== undefined} THEN ${department ?? null} ELSE department END,
      updated_at = now()
    WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await sql`DELETE FROM projects WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
