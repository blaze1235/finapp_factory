import { sql } from "@/server/db";
import { departments, orgUnit, projects, unitWorkers, workers } from "@/server/office/registry";
import { createTask, runTask } from "@/server/office/orchestrator";
import { sendMessage, answerCallback, type InlineButton } from "./api";

const APP = () => process.env.APP_BASE_URL || "https://web-production-c73a5.up.railway.app";

async function getSetting(key: string): Promise<string | null> {
  const [row] = await sql`SELECT value FROM settings WHERE key = ${key}`;
  return row?.value ?? null;
}

async function setSetting(key: string, value: string) {
  await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})
            ON CONFLICT (key) DO UPDATE SET value = ${value}`;
}

export async function ownerChatId(): Promise<string | null> {
  return getSetting("tg_chat_id");
}

/** Telegram update router. Kept deliberately small: /start /team /status, dept callbacks, plain text → task. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleUpdate(update: any): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query);
  const msg = update.message;
  if (!msg?.chat?.id || typeof msg.text !== "string") return;
  const chatId = msg.chat.id as number;
  const text = msg.text.trim();

  // single-user app: first /start claims the bot; same chat can always re-claim
  const saved = await ownerChatId();
  if (text.startsWith("/start")) {
    await setSetting("tg_chat_id", String(chatId));
    await sendMessage(
      chatId,
      `🏢 *AI OS connected.*\n\nSend me any task in plain words — I'll route it to the right department and message you when the deliverable is ready.\n\nCommands:\n/team — departments & agents\n/status — active + recent tasks\n/report — this week's team reports`,
      [[{ text: "🏢 Open the office", url: `${APP()}/office` }]],
    );
    return;
  }
  if (saved && String(chatId) !== saved) {
    await sendMessage(chatId, "This is Abdulaziz's personal AI OS bot. 🔒");
    return;
  }
  if (!saved) {
    await sendMessage(chatId, "Send /start first to connect this chat.");
    return;
  }

  if (text.startsWith("/team")) {
    const rows: InlineButton[][] = [
      ...Object.values(departments).map((d) => [
        { text: `🏛 ${d.name} (${unitWorkers(d.key).length})`, callback_data: `team:${d.key}` },
      ]),
      ...Object.values(projects).map((p) => [
        { text: `🚀 ${p.name} squad (${unitWorkers(p.key).length})`, callback_data: `team:${p.key}` },
      ]),
    ];
    await sendMessage(chatId, "*Departments & Projects* — tap one to see the team:", rows);
    return;
  }

  if (text.startsWith("/status")) {
    const tasks = await sql`SELECT title, department, status FROM tasks ORDER BY created_at DESC LIMIT 8`;
    if (tasks.length === 0) {
      await sendMessage(chatId, "No tasks yet. Send me one!");
      return;
    }
    const lines = (tasks as unknown as { title: string; department: string; status: string }[])
      .map((t) => {
        const icon = t.status === "done" ? "✅" : t.status === "failed" ? "❌" : "⏳";
        const dept = orgUnit(t.department)?.name ?? "routing…";
        return `${icon} *${t.title}* — ${dept}`;
      })
      .join("\n");
    await sendMessage(chatId, `*Recent tasks:*\n${lines}`, [[{ text: "Open task board", url: `${APP()}/office` }]]);
    return;
  }

  if (text.startsWith("/report")) {
    await sendMessage(chatId, "📊 Opening this week's team reports:", [
      [{ text: "View reports", url: `${APP()}/reports` }],
    ]);
    return;
  }

  // plain text → auto-routed task
  const id = await createTask(text);
  await sendMessage(
    chatId,
    `🎯 *Task received.* The orchestrator is routing it to the right department — I'll message you when the deliverable is ready.`,
    [[{ text: "Watch the office live", url: `${APP()}/office` }]],
  );
  // awaited so Next's after() keeps the process alive until the task (and its notification) completes
  await runTask(id).catch(() => {});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCallback(cb: any): Promise<void> {
  const data = String(cb.data ?? "");
  const chatId = cb.message?.chat?.id;
  await answerCallback(cb.id);
  if (!chatId) return;

  if (data.startsWith("team:")) {
    const dept = orgUnit(data.slice(5));
    if (!dept) return;
    const team = unitWorkers(dept.key)
      .map((w) => `${dept.lead === w.key ? "⭐" : "•"} *${w.name}* — ${w.role}`)
      .join("\n");
    await sendMessage(chatId, `*${dept.name}*\n_${dept.description}_\n\n${team}`, [
      [{ text: `💬 Chat with ${workers[dept.lead].name}`, url: `${APP()}/chats?dept=${dept.key}` }],
    ]);
  }
}

/** Called by the orchestrator when a task finishes (done or failed). */
export async function notifyTaskFinished(taskId: string): Promise<void> {
  const chatId = await ownerChatId();
  if (!chatId) return;
  const [task] = await sql`SELECT title, department, status, result, error FROM tasks WHERE id = ${taskId}`;
  if (!task) return;
  const dept = orgUnit(task.department);
  if (task.status === "done") {
    const excerpt = (task.result ?? "").replace(/[#*_`>]/g, "").slice(0, 500);
    await sendMessage(
      chatId,
      `✅ *${task.title}* — done by ${dept?.name ?? "the team"}.\n\n${excerpt}${(task.result?.length ?? 0) > 500 ? "…" : ""}`,
      [[{ text: "📄 Full deliverable", url: `${APP()}/office` }]],
    );
  } else {
    await sendMessage(chatId, `❌ *${task.title}* failed: ${(task.error ?? "unknown error").slice(0, 200)}`);
  }
}
