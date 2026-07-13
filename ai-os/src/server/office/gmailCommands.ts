import { sql } from "@/server/db";
import { isGmailConnected, searchEmails, createDraftEmail } from "@/server/gmail/client";
import { generateJson } from "./llm";
import { workers } from "./registry";

const SEARCH_RE = /^\/?email\s+search[:\s]+(.+)$/is;
const DRAFT_RE = /^\/?draft\s+email\s+to\s+([^\s:]+)\s*:?\s*(.+)$/is;

async function reply(chatId: string, workerKey: string | null, content: string) {
  await sql`INSERT INTO messages (chat_id, role, worker_key, content) VALUES (${chatId}, 'agent', ${workerKey}, ${content})`;
  await sql`UPDATE chats SET updated_at = now() WHERE id = ${chatId}`;
}

const NOT_CONNECTED =
  "📧 Gmail isn't connected yet. Go to the Agents page and hit **Connect Gmail** — Abdulaziz needs to authorize it once.";

/**
 * Deterministic Gmail commands, same pattern as "remember:" — recognized in ANY chat.
 * "email search: <query>" — read-only inbox search, no LLM needed for the search itself.
 * "draft email to <addr>: <what it should say>" — one LLM call composes it, then a real
 * Gmail DRAFT is created (never sent).
 */
export async function tryHandleGmailCommand(text: string, chatId: string, speakerKey: string | null): Promise<boolean> {
  const trimmed = text.trim();

  const searchMatch = SEARCH_RE.exec(trimmed);
  if (searchMatch) {
    if (!(await isGmailConnected())) {
      await reply(chatId, speakerKey, NOT_CONNECTED);
      return true;
    }
    try {
      const hits = await searchEmails(searchMatch[1].trim(), 6);
      const body = hits.length
        ? hits.map((h) => `**${h.subject || "(no subject)"}** — ${h.from}, ${h.date}\n${h.snippet}`).join("\n\n")
        : "No matching emails.";
      await reply(chatId, speakerKey, `📧 *Inbox search results:*\n\n${body}`);
    } catch (e) {
      await reply(chatId, speakerKey, `⚠️ Gmail search failed: ${String(e).slice(0, 150)}`);
    }
    return true;
  }

  const draftMatch = DRAFT_RE.exec(trimmed);
  if (draftMatch) {
    if (!(await isGmailConnected())) {
      await reply(chatId, speakerKey, NOT_CONNECTED);
      return true;
    }
    const to = draftMatch[1].trim();
    const instructions = draftMatch[2].trim();
    try {
      const speaker = speakerKey ? workers[speakerKey] : null;
      const { subject, body } = await generateJson<{ subject: string; body: string }>(
        `${speaker?.persona ?? "You are Theo, Abdulaziz's personal assistant."} You draft real business emails on his behalf. Professional, concise, no filler. Return JSON only.`,
        `Draft an email to ${to}. What it should say: ${instructions}\n\nReturn JSON: {"subject": "...", "body": "..."}`,
      );
      await createDraftEmail(to, subject, body);
      await reply(
        chatId,
        speakerKey,
        `📧 Draft created — check your Gmail Drafts folder.\n\n**To:** ${to}\n**Subject:** ${subject}\n\n${body}`,
      );
    } catch (e) {
      await reply(chatId, speakerKey, `⚠️ Couldn't create the draft: ${String(e).slice(0, 150)}`);
    }
    return true;
  }

  return false;
}
