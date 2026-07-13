import { NextResponse } from "next/server";
import { after } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";
import { currentWeekStart, getReports, generateWeeklyReports } from "@/server/office/reports";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const week = currentWeekStart();
  const reports = await getReports(week);
  return NextResponse.json({ week, reports });
}

export async function POST() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const week = currentWeekStart();
  // mark as generating so the UI can poll
  await sql`INSERT INTO settings (key, value) VALUES ('reports_generating', ${week})
            ON CONFLICT (key) DO UPDATE SET value = ${week}`;
  after(async () => {
    try {
      await generateWeeklyReports();
    } finally {
      await sql`UPDATE settings SET value = '' WHERE key = 'reports_generating'`;
    }
  });
  return NextResponse.json({ ok: true, week });
}
