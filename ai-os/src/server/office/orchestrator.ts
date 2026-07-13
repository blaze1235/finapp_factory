import { randomUUID } from "crypto";
import { sql } from "@/server/db";
import { notifyTaskFinished } from "@/server/telegram/handlers";
import { departments, deptWorkers, workers, type DeptKey } from "./registry";
import { PORTFOLIO_CONTEXT } from "./context";
import { generate, generateJson } from "./llm";
import { GROUNDING, liveDataFor, knowledgeFor, projectContextFor } from "./grounding";

interface PlanSubtask {
  worker: string;
  title: string;
  instructions: string;
}

interface Plan {
  title: string;
  department: DeptKey;
  subtasks: PlanSubtask[];
}

async function emit(taskId: string, message: string, workerKey?: string) {
  await sql`INSERT INTO events (task_id, worker_key, message)
            VALUES (${taskId}, ${workerKey ?? null}, ${message})`;
}

async function setTask(taskId: string, fields: { status?: string; result?: string; error?: string; title?: string; department?: string }) {
  await sql`UPDATE tasks SET
      status = COALESCE(${fields.status ?? null}, status),
      result = COALESCE(${fields.result ?? null}, result),
      error = COALESCE(${fields.error ?? null}, error),
      title = COALESCE(${fields.title ?? null}, title),
      department = COALESCE(${fields.department ?? null}, department),
      updated_at = now()
    WHERE id = ${taskId}`;
}

export async function createTask(brief: string, department?: DeptKey): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO tasks (id, title, brief, department, status)
            VALUES (${id}, ${brief.slice(0, 80)}, ${brief}, ${department ?? "auto"}, 'planning')`;
  await emit(id, "Task received. Orchestrator reviewing the brief…");
  return id;
}

/** Full orchestration run. Called after the task row exists; safe to fire-and-forget. */
export async function runTask(taskId: string): Promise<void> {
  try {
    const [task] = await sql`SELECT * FROM tasks WHERE id = ${taskId}`;
    if (!task) return;

    // ── 1. Plan ────────────────────────────────────────
    const deptList = Object.values(departments)
      .map((d) => `- "${d.key}": ${d.name} — ${d.description}\n  workers: ${deptWorkers(d.key).map((w) => `"${w.key}" (${w.name}, ${w.role})`).join(", ")}`)
      .join("\n");

    const forced = task.department !== "auto" ? `The user pre-selected department "${task.department}". Use it.` : "Pick the single best department.";

    const plan = await generateJson<Plan>(
      `You are the Master Orchestrator of Abdulaziz's AI OS. You dispatch work to departments of specialist agents.\n${PORTFOLIO_CONTEXT}`,
      `Task brief:\n"""${task.brief}"""\n\nDepartments and workers:\n${deptList}\n\n${forced}\n\nDecompose the brief into 2-4 focused subtasks for DIFFERENT workers of that department (use each worker at most once; pick the most relevant workers). Keep the department lead for review — do NOT assign the lead a subtask unless the team is small.\n\nReturn JSON: {"title": "short task title (max 8 words)", "department": "<dept key>", "subtasks": [{"worker": "<worker key>", "title": "short subtask name", "instructions": "specific instructions for this worker"}]}`,
    );

    const dept = departments[plan.department] ?? departments.brain;
    const valid = plan.subtasks.filter((s) => workers[s.worker] && workers[s.worker].dept === dept.key);
    if (valid.length === 0) throw new Error("Planner produced no valid subtasks");

    await setTask(taskId, { status: "working", title: plan.title, department: dept.key });
    await emit(taskId, `Plan ready → ${dept.name} team, ${valid.length} subtasks. Team walking to their desks…`);

    for (let i = 0; i < valid.length; i++) {
      const st = valid[i];
      await sql`INSERT INTO subtasks (id, task_id, worker_key, title, status, position)
                VALUES (${randomUUID()}, ${taskId}, ${st.worker}, ${st.title}, 'pending', ${i})`;
    }

    // ── 2. Workers execute (sequentially — free-tier friendly) ──
    const outputs: { worker: string; title: string; output: string }[] = [];
    const rows = await sql`SELECT * FROM subtasks WHERE task_id = ${taskId} ORDER BY position`;
    const knowledge = await knowledgeFor(task.brief);

    for (const row of rows) {
      const w = workers[row.worker_key];
      const st = valid.find((s) => s.worker === row.worker_key)!;
      await sql`UPDATE subtasks SET status = 'working' WHERE id = ${row.id}`;
      await emit(taskId, `${w.name} started: ${row.title}`, w.key);

      try {
        const output = await generate(
          `${w.persona}\n${PORTFOLIO_CONTEXT}${await liveDataFor(w)}${await projectContextFor(w)}${knowledge}\n${GROUNDING}`,
          `Overall task: ${task.brief}\n\nYour subtask: ${row.title}\nInstructions: ${st.instructions}\n\n${outputs.length > 0 ? `Work already done by teammates:\n${outputs.map((o) => `### ${workers[o.worker].name} — ${o.title}\n${o.output}`).join("\n\n")}\n\nBuild on it, don't repeat it.` : ""}\n\nDeliver your part now.`,
        );
        outputs.push({ worker: w.key, title: row.title, output });
        await sql`UPDATE subtasks SET status = 'done', output = ${output} WHERE id = ${row.id}`;
        await emit(taskId, `${w.name} finished ${row.title} ✔`, w.key);
      } catch (e) {
        await sql`UPDATE subtasks SET status = 'failed', output = ${String(e)} WHERE id = ${row.id}`;
        await emit(taskId, `${w.name} hit a problem: ${String(e).slice(0, 120)}`, w.key);
      }
    }

    if (outputs.length === 0) throw new Error("All workers failed");

    // ── 3. Lead synthesizes ────────────────────────────
    const lead = workers[dept.lead];
    await setTask(taskId, { status: "synthesizing" });
    await emit(taskId, `${lead.name} is assembling the final deliverable…`, lead.key);

    const result = await generate(
      `${lead.persona}\n${PORTFOLIO_CONTEXT}${await liveDataFor(lead)}${await projectContextFor(lead)}\n${GROUNDING}`,
      `Task: ${task.brief}\n\nYour team produced:\n${outputs.map((o) => `## ${workers[o.worker].name} (${workers[o.worker].role}) — ${o.title}\n${o.output}`).join("\n\n")}\n\nAs team lead, merge everything into ONE polished, vault-ready Markdown deliverable. Structure: brief summary → the deliverable content → "## Action Items" checklist at the end. Resolve contradictions; cut fluff; keep the strongest ideas.`,
    );

    await setTask(taskId, { status: "done", result });
    await emit(taskId, `Deliverable ready. ${dept.name} team heading to the coffee corner ☕`, lead.key);
    await notifyTaskFinished(taskId).catch(() => {});
  } catch (e) {
    await setTask(taskId, { status: "failed", error: String(e) });
    await emit(taskId, `Task failed: ${String(e).slice(0, 200)}`);
    await notifyTaskFinished(taskId).catch(() => {});
  }
}
