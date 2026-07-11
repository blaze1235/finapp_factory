import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";
import { departments, workers, type DeptKey } from "@/server/office/registry";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const chats = await sql`SELECT id, scope, department, worker_key, title, busy, updated_at FROM chats
                          ORDER BY updated_at DESC LIMIT 100`;
  return NextResponse.json({ chats });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { scope, department, worker, title } = await req.json().catch(() => ({}));

  if (scope === "dm") {
    if (typeof worker !== "string" || !workers[worker]) {
      return NextResponse.json({ error: "bad worker" }, { status: 400 });
    }
    // one persistent DM thread per worker — return the existing one if it's already there
    const [existing] = await sql`SELECT id FROM chats WHERE scope = 'dm' AND worker_key = ${worker}`;
    if (existing) return NextResponse.json({ id: existing.id });

    const id = randomUUID();
    await sql`INSERT INTO chats (id, scope, worker_key, title)
              VALUES (${id}, 'dm', ${worker}, ${workers[worker].name})`;
    return NextResponse.json({ id });
  }

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
