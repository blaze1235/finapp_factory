import { NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";

/** Live office state: what every worker is doing right now + activity ticker. */
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = await sql`
    SELECT t.id, t.title, t.department, t.status,
           COALESCE(json_agg(json_build_object(
             'worker', s.worker_key, 'title', s.title, 'status', s.status
           ) ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL), '[]') AS subtasks
    FROM tasks t
    LEFT JOIN subtasks s ON s.task_id = t.id
    WHERE t.status IN ('planning', 'working', 'synthesizing')
    GROUP BY t.id
    ORDER BY t.created_at DESC`;

  const ticker = await sql`
    SELECT e.worker_key, e.message, e.created_at
    FROM events e ORDER BY e.id DESC LIMIT 12`;

  return NextResponse.json({ active, ticker });
}
