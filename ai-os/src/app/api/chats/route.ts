import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";
import { departments, type DeptKey } from "@/server/office/registry";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const chats = await sql`SELECT id, scope, department, title, busy, updated_at FROM chats
                          ORDER BY updated_at DESC LIMIT 100`;
  return NextResponse.json({ chats });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { scope, department, title } = await req.json().catch(() => ({}));

  const isOffice = scope === "office";
  if (!isOffice && !(department && departments[department as DeptKey])) {
    return NextResponse.json({ error: "bad department" }, { status: 400 });
  }
  const name = typeof title === "string" && title.trim() ? title.trim().slice(0, 60) : isOffice ? "New idea" : "General";

  const id = randomUUID();
  await sql`INSERT INTO chats (id, scope, department, title)
            VALUES (${id}, ${isOffice ? "office" : "dept"}, ${isOffice ? null : department}, ${name})`;
  return NextResponse.json({ id });
}
