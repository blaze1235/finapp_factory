import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [task] = await sql`SELECT * FROM tasks WHERE id = ${id}`;
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const subtasks = await sql`SELECT id, worker_key, title, status, output, position
                             FROM subtasks WHERE task_id = ${id} ORDER BY position`;
  const events = await sql`SELECT worker_key, message, created_at FROM events
                           WHERE task_id = ${id} ORDER BY id`;
  return NextResponse.json({ task, subtasks, events });
}
