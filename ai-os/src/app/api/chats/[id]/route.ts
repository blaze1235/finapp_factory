import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [chat] = await sql`SELECT id, scope, department, title, busy FROM chats WHERE id = ${id}`;
  if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = await sql`SELECT id, role, worker_key, content, created_at FROM messages
                             WHERE chat_id = ${id} ORDER BY id LIMIT 200`;
  return NextResponse.json({ chat, messages });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await sql`DELETE FROM chats WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
