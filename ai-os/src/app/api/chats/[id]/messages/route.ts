import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";
import { runDeptReply, runOfficeCollab, runDmReply } from "@/server/office/collab";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { content } = await req.json().catch(() => ({}));
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }
  const [chat] = await sql`SELECT id, scope, busy FROM chats WHERE id = ${id}`;
  if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (chat.busy) return NextResponse.json({ error: "team is still replying" }, { status: 409 });

  await sql`INSERT INTO messages (chat_id, role, worker_key, content)
            VALUES (${id}, 'user', NULL, ${content.trim()})`;
  await sql`UPDATE chats SET busy = true, updated_at = now() WHERE id = ${id}`;

  after(() => {
    if (chat.scope === "office") return runOfficeCollab(id);
    if (chat.scope === "dm") return runDmReply(id);
    return runDeptReply(id);
  });
  return NextResponse.json({ ok: true });
}
