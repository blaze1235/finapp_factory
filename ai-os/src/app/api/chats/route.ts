import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";
import { orgUnit, workers } from "@/server/office/registry";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const chats = await sql`
    SELECT c.id, c.scope, c.department, c.worker_key, c.title, c.busy, c.updated_at,
           COALESCE(
             (SELECT array_agg(cp.worker_key) FROM chat_participants cp WHERE cp.chat_id = c.id),
             '{}'
           ) AS participants
    FROM chats c
    ORDER BY c.updated_at DESC LIMIT 100`;
  return NextResponse.json({ chats });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { scope, department, worker, participants, title } = await req.json().catch(() => ({}));

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

  if (scope === "collab") {
    const keys: unknown[] = Array.isArray(participants) ? participants : [];
    const valid = [...new Set(keys.filter((k): k is string => typeof k === "string" && !!workers[k]))];
    if (valid.length < 2) {
      return NextResponse.json({ error: "pick at least 2 people for a collab room" }, { status: 400 });
    }
    const name =
      typeof title === "string" && title.trim() ? title.trim().slice(0, 60) : valid.map((k) => workers[k].name).join(" + ");

    const id = randomUUID();
    await sql`INSERT INTO chats (id, scope, title) VALUES (${id}, 'collab', ${name})`;
    for (const key of valid) {
      await sql`INSERT INTO chat_participants (chat_id, worker_key) VALUES (${id}, ${key})`;
    }
    return NextResponse.json({ id });
  }

  const isOffice = scope === "office";
  if (!isOffice && !(department && orgUnit(department))) {
    return NextResponse.json({ error: "bad department" }, { status: 400 });
  }
  const name = typeof title === "string" && title.trim() ? title.trim().slice(0, 60) : isOffice ? "New idea" : "General";

  const id = randomUUID();
  await sql`INSERT INTO chats (id, scope, department, title)
            VALUES (${id}, ${isOffice ? "office" : "dept"}, ${isOffice ? null : department}, ${name})`;
  return NextResponse.json({ id });
}
