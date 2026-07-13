import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";
import { runDeptReply, runOfficeCollab, runDmReply, runCollabReply } from "@/server/office/collab";
import { tryCaptureFromMessage } from "@/server/office/knowledge";
import { tryHandleGmailCommand } from "@/server/office/gmailCommands";
import { departments, type DeptKey } from "@/server/office/registry";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { content } = await req.json().catch(() => ({}));
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }
  const [chat] = await sql`SELECT id, scope, busy, department, worker_key FROM chats WHERE id = ${id}`;
  if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (chat.busy) return NextResponse.json({ error: "team is still replying" }, { status: 409 });

  const trimmed = content.trim();
  await sql`INSERT INTO messages (chat_id, role, worker_key, content)
            VALUES (${id}, 'user', NULL, ${trimmed})`;

  // "remember: ..." is captured deterministically — no LLM call, instant, free.
  const captured = await tryCaptureFromMessage(trimmed, id);
  if (captured) {
    await sql`INSERT INTO messages (chat_id, role, worker_key, content)
              VALUES (${id}, 'agent', NULL, ${"🧠 Got it — I'll remember that for the whole team."})`;
    await sql`UPDATE chats SET updated_at = now() WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  }

  // "email search: ..." / "draft email to ...: ..." — deterministic dispatch, no chat busy-state.
  const speakerKey = chat.worker_key ?? (chat.department ? departments[chat.department as DeptKey]?.lead ?? null : null);
  const handledGmail = await tryHandleGmailCommand(trimmed, id, speakerKey);
  if (handledGmail) return NextResponse.json({ ok: true });

  await sql`UPDATE chats SET busy = true, updated_at = now() WHERE id = ${id}`;

  after(() => {
    if (chat.scope === "office") return runOfficeCollab(id);
    if (chat.scope === "dm") return runDmReply(id);
    if (chat.scope === "collab") return runCollabReply(id);
    return runDeptReply(id);
  });
  return NextResponse.json({ ok: true });
}
