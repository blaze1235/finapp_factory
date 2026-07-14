import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";
import { createTask, runTask } from "@/server/office/orchestrator";
import { orgUnit, type DeptKey, type ProjectKey } from "@/server/office/registry";

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { brief, department } = await req.json().catch(() => ({}));
  if (typeof brief !== "string" || brief.trim().length < 5) {
    return NextResponse.json({ error: "Brief too short" }, { status: 400 });
  }
  const dept = department && orgUnit(department) ? (department as DeptKey | ProjectKey) : undefined;

  const id = await createTask(brief.trim(), dept);
  after(() => runTask(id));
  return NextResponse.json({ id });
}

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tasks = await sql`SELECT id, title, department, status, created_at FROM tasks
                          ORDER BY created_at DESC LIMIT 30`;
  return NextResponse.json({ tasks });
}
