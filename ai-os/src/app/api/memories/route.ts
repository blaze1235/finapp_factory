import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { listMemories, deleteMemory } from "@/server/office/knowledge";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const memories = await listMemories();
  return NextResponse.json({ memories });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await deleteMemory(id);
  return NextResponse.json({ ok: true });
}
