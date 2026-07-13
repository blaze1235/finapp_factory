import { randomUUID } from "crypto";
import { sql } from "@/server/db";
import { departments, workers } from "./registry";
import { generate } from "./llm";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Monday of the current week (UTC date string). */
export function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1));
  return monday.toISOString().slice(0, 10);
}

export async function getReports(weekStart: string) {
  return sql`SELECT department, content, created_at FROM reports
             WHERE week_start = ${weekStart} ORDER BY department`;
}

/**
 * One report per department lead, built ONLY from real recorded activity that week
 * (tasks + chat messages). Departments with zero activity get a fixed line — no LLM
 * call at all (free, and nothing to hallucinate about).
 */
export async function generateWeeklyReports(): Promise<void> {
  const week = currentWeekStart();

  for (const dept of Object.values(departments)) {
    const tasks = await sql`
      SELECT title, status, result FROM tasks
      WHERE department = ${dept.key} AND created_at >= ${week}::date
      ORDER BY created_at`;
    const teamKeys = Object.values(workers)
      .filter((w) => w.dept === dept.key)
      .map((w) => w.key);
    const msgs = await sql`
      SELECT count(*)::int AS n FROM messages
      WHERE worker_key = ANY(${teamKeys}) AND created_at >= ${week}::date`;
    const msgCount = (msgs[0]?.n as number) ?? 0;

    let content: string;
    if (tasks.length === 0 && msgCount === 0) {
      content = "_No recorded activity this week — no tasks or discussions involved this team._";
    } else {
      const lead = workers[dept.lead];
      const taskLines = (tasks as unknown as { title: string; status: string; result: string | null }[])
        .map((t) => `- [${t.status}] ${t.title}${t.result ? ` — outcome: ${t.result.replace(/[#*_`]/g, "").slice(0, 200)}` : ""}`)
        .join("\n");
      content = await generate(
        `${lead.persona}\nYou are writing your weekly report to Abdulaziz (the boss). STRICT RULE: mention ONLY the activity listed below — do not invent tasks, numbers or outcomes that are not in the list. If the week was thin, say so honestly. Format: **Done** (bullets), **Notable** (1-2 lines), **Suggested next week** (bullets, clearly marked as suggestions). Under 150 words.`,
        `Real recorded activity for ${dept.name} this week (since ${week}):\n\nTasks:\n${taskLines || "(none)"}\n\nChat messages sent by the team: ${msgCount}\n\nWrite the report now.`,
      );
      await sleep(300);
    }

    await sql`
      INSERT INTO reports (id, week_start, department, content)
      VALUES (${randomUUID()}, ${week}, ${dept.key}, ${content})
      ON CONFLICT (week_start, department) DO UPDATE SET content = ${content}, created_at = now()`;
  }
}
