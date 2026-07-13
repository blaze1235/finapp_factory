import { sql } from "@/server/db";
import { departments, workers, type DeptKey } from "./registry";
import { PORTFOLIO_CONTEXT } from "./context";
import { generate, generateJson } from "./llm";
import { beginCollab, endCollab } from "./simEngine";
import { GROUNDING, liveDataFor, knowledgeFor, projectContextFor } from "./grounding";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHAT_STYLE =
  "This is a live office chat, not a report. Reply as yourself in 40-140 words, conversational but substantive. React to what others said (agree, push back, add numbers). No headings, no sign-offs. Plain text or light markdown (bold, short lists) only.";

const DM_STYLE =
  "This is a private 1:1 chat with Abdulaziz, your boss — not a group channel. Be direct, personal and concise (30-120 words). You can ask him clarifying questions. No headings, no \"as an AI\" framing, no sign-offs. Plain text or light markdown only.";

interface MsgRow {
  role: string;
  worker_key: string | null;
  content: string;
}

/** Keeps only the most recent N turns — a growing collab/DM would otherwise resend the whole
 *  history (plus PORTFOLIO_CONTEXT) on every single call, blowing through Groq's per-minute
 *  token limits well before the conversation is actually done. */
function transcript(msgs: MsgRow[], maxTurns = 14): string {
  return msgs
    .slice(-maxTurns)
    .map((m) => {
      if (m.role === "user") return `Abdulaziz (boss): ${m.content}`;
      if (m.worker_key && workers[m.worker_key]) {
        const w = workers[m.worker_key];
        return `${w.name} (${w.role}, ${departments[w.dept].name}): ${m.content}`;
      }
      return `Orchestrator: ${m.content}`;
    })
    .join("\n\n");
}

async function addMessage(chatId: string, workerKey: string | null, content: string) {
  await sql`INSERT INTO messages (chat_id, role, worker_key, content)
            VALUES (${chatId}, 'agent', ${workerKey}, ${content})`;
  await sql`UPDATE chats SET updated_at = now() WHERE id = ${chatId}`;
}

async function setBusy(chatId: string, busy: boolean) {
  await sql`UPDATE chats SET busy = ${busy}, updated_at = now() WHERE id = ${chatId}`;
}

/** Department chat: the team lead answers; if the user addressed a teammate by name, that teammate answers. */
export async function runDeptReply(chatId: string): Promise<void> {
  try {
    const [chat] = await sql`SELECT * FROM chats WHERE id = ${chatId}`;
    if (!chat?.department) return;
    const dept = departments[chat.department as DeptKey];
    const msgs = (await sql`SELECT role, worker_key, content FROM messages
                            WHERE chat_id = ${chatId} ORDER BY id DESC LIMIT 24`).reverse() as unknown as MsgRow[];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";

    // addressed teammate?
    let speaker = workers[dept.lead];
    for (const w of Object.values(workers)) {
      if (w.dept === dept.key && w.key !== dept.lead && new RegExp(`\\b${w.name}\\b`, "i").test(lastUser)) {
        speaker = w;
        break;
      }
    }

    const reply = await generate(
      `${speaker.persona}\n${PORTFOLIO_CONTEXT}${await liveDataFor(speaker)}${await projectContextFor(speaker)}${await knowledgeFor(lastUser)}\nYou are chatting in the "${chat.title}" channel of the ${dept.name} room. ${GROUNDING} ${CHAT_STYLE}`,
      `Conversation so far:\n\n${transcript(msgs)}\n\nReply now as ${speaker.name}.`,
    );
    await addMessage(chatId, speaker.key, reply);
  } catch (e) {
    await addMessage(chatId, null, `⚠️ Reply failed: ${String(e).slice(0, 180)}`);
  } finally {
    await setBusy(chatId, false);
  }
}

/** Direct message: always replies as the one specific worker this thread belongs to. */
export async function runDmReply(chatId: string): Promise<void> {
  try {
    const [chat] = await sql`SELECT * FROM chats WHERE id = ${chatId}`;
    const speaker = chat?.worker_key ? workers[chat.worker_key] : null;
    if (!speaker) return;
    const msgs = (await sql`SELECT role, worker_key, content FROM messages
                            WHERE chat_id = ${chatId} ORDER BY id DESC LIMIT 24`).reverse() as unknown as MsgRow[];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";

    const reply = await generate(
      `${speaker.persona}\n${PORTFOLIO_CONTEXT}${await liveDataFor(speaker)}${await projectContextFor(speaker)}${await knowledgeFor(lastUser)}\n${GROUNDING} ${DM_STYLE}`,
      `Conversation so far:\n\n${transcript(msgs)}\n\nReply now as ${speaker.name}.`,
    );
    await addMessage(chatId, speaker.key, reply);
  } catch (e) {
    await addMessage(chatId, null, `⚠️ Reply failed: ${String(e).slice(0, 180)}`);
  } finally {
    await setBusy(chatId, false);
  }
}

/**
 * Persistent multi-agent collab room: a fixed roster picked by Abdulaziz once (e.g. Lina +
 * Max, or the whole BlazeRent + Marketing pairing), standing across many messages — unlike
 * office collabs, which pick a fresh ad-hoc roster per idea. Every member weighs in on each
 * message, building on the others, so specialists from different departments actually work
 * off each other's numbers.
 */
export async function runCollabReply(chatId: string): Promise<void> {
  try {
    const participantRows = await sql`SELECT worker_key FROM chat_participants WHERE chat_id = ${chatId}`;
    const participantKeys = (participantRows as unknown as { worker_key: string }[])
      .map((r) => r.worker_key)
      .filter((k) => workers[k]);
    if (participantKeys.length < 2) return;

    const [chat] = await sql`SELECT * FROM chats WHERE id = ${chatId}`;
    const msgs = (await sql`SELECT role, worker_key, content FROM messages
                            WHERE chat_id = ${chatId} ORDER BY id DESC LIMIT 24`).reverse() as unknown as MsgRow[];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
    const knowledge = await knowledgeFor(lastUser);

    // whoever was addressed by name speaks first; the rest follow and build on it
    const addressed = participantKeys.find((k) => new RegExp(`\\b${workers[k].name}\\b`, "i").test(lastUser));
    const order = addressed ? [addressed, ...participantKeys.filter((k) => k !== addressed)] : participantKeys;
    const roomLabel = order.map((k) => `${workers[k].name} (${workers[k].role}, ${departments[workers[k].dept].name})`).join(", ");

    beginCollab(order);
    try {
      const running: MsgRow[] = [...msgs];
      for (const key of order) {
        const w = workers[key];
        const text = await generate(
          `${w.persona}\n${PORTFOLIO_CONTEXT}${await liveDataFor(w)}${await projectContextFor(w)}${knowledge}\nYou're in a standing collab room called "${chat.title}" with: ${roomLabel}. Build on what your roommates just said in this same turn — don't repeat them, add your specialty's angle. ${GROUNDING} ${CHAT_STYLE}`,
          `Conversation so far:\n\n${transcript(running)}\n\nSpeak now as ${w.name}.`,
        );
        await addMessage(chatId, key, text);
        running.push({ role: "agent", worker_key: key, content: text });
        await sleep(300);
      }
    } finally {
      endCollab(order);
    }
  } catch (e) {
    await addMessage(chatId, null, `⚠️ Reply failed: ${String(e).slice(0, 180)}`);
  } finally {
    await setBusy(chatId, false);
  }
}

interface CollabPlan {
  participants: { worker: string; angle: string }[];
}

/** Office collab (#223): orchestrator picks relevant agents across ALL departments; they debate, then a summary lands. */
export async function runOfficeCollab(chatId: string): Promise<void> {
  try {
    const msgs = (await sql`SELECT role, worker_key, content FROM messages
                            WHERE chat_id = ${chatId} ORDER BY id DESC LIMIT 30`).reverse() as unknown as MsgRow[];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
    const knowledge = await knowledgeFor(lastUser);

    const roster = Object.values(workers)
      .map((w) => `"${w.key}" — ${w.name}, ${w.role} (${departments[w.dept].name})`)
      .join("\n");

    const plan = await generateJson<CollabPlan>(
      `You are the Master Orchestrator of Abdulaziz's AI OS. He just dropped an idea/question in the all-hands office chat. Pick the RIGHT people across departments to discuss it — like pulling chairs to a table.\n${PORTFOLIO_CONTEXT}${knowledge}`,
      `His message:\n"""${lastUser}"""\n\nPrior discussion:\n${transcript(msgs.slice(0, -1)) || "(none)"}\n\nRoster:\n${roster}\n\nPick 3-6 workers from DIFFERENT relevant departments (finance perspective almost always useful for business ideas; add market/research, product, and execution angles). Order them so the discussion builds. Return JSON: {"participants":[{"worker":"<key>","angle":"what this person should examine (feasibility, cost, market fit, risks, growth...)"}]}`,
    );

    const picked = plan.participants
      .filter((p) => workers[p.worker])
      .slice(0, 6);
    if (picked.length === 0) throw new Error("No participants selected");

    const pickedKeys = picked.map((p) => p.worker);
    beginCollab(pickedKeys);
    try {
      const running: MsgRow[] = [...msgs];
      for (const p of picked) {
        const w = workers[p.worker];
        const text = await generate(
          `${w.persona}\n${PORTFOLIO_CONTEXT}${await liveDataFor(w)}${await projectContextFor(w)}${knowledge}\nYou were pulled into the all-hands office chat to discuss the boss's idea. Your angle: ${p.angle}. Be honest — if the numbers don't work, say so; if data is missing, name it and ask. ${GROUNDING} ${CHAT_STYLE}`,
          `Discussion so far:\n\n${transcript(running)}\n\nSpeak now as ${w.name}.`,
        );
        await addMessage(chatId, w.key, text);
        running.push({ role: "agent", worker_key: w.key, content: text });
        await sleep(350);
      }

      const summary = await generate(
        `You are the Master Orchestrator. Wrap up the office discussion for Abdulaziz. Output compact markdown: **Verdict** (1-2 sentences, honest), **Key points** (3-5 bullets crediting who said what), **Open questions for Abdulaziz** (only if the team asked for missing data), **Action items** (checklist). Under 200 words. Never add numbers the discussion itself did not contain.\n${PORTFOLIO_CONTEXT}`,
        `Idea: """${lastUser}"""\n\nDiscussion:\n\n${transcript(running)}`,
      );
      await addMessage(chatId, null, summary);
    } finally {
      endCollab(pickedKeys);
    }
  } catch (e) {
    await addMessage(chatId, null, `⚠️ Collab failed: ${String(e).slice(0, 180)}`);
  } finally {
    await setBusy(chatId, false);
  }
}
