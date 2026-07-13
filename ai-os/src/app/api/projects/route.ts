import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projects = await sql`
    SELECT p.id, p.name, p.purpose, p.department, p.sort_order, p.updated_at,
           COALESCE(
             (SELECT json_agg(json_build_object('id', d.id, 'filename', d.filename) ORDER BY d.created_at DESC)
              FROM documents d WHERE d.project_id = p.id),
             '[]'
           ) AS files
    FROM projects p
    ORDER BY p.department NULLS LAST, p.sort_order, p.name`;
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name, purpose, department } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const id = randomUUID();
  await sql`INSERT INTO projects (id, name, purpose, department)
            VALUES (${id}, ${name.trim().slice(0, 120)}, ${typeof purpose === "string" ? purpose.slice(0, 4000) : ""}, ${department ?? null})`;
  return NextResponse.json({ id });
}
