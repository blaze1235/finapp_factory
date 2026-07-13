import { randomUUID } from "crypto";
import { sql } from "@/server/db";

/**
 * Shared team knowledge, spanning chats AND tasks so the two aren't siloed:
 * - `memories`: durable facts Abdulaziz explicitly asked the team to remember (deterministic
 *   capture, zero LLM cost — matches his cost-conscious preference).
 * - past task deliverables: every finished task's result is searchable too, so a chat can
 *   reference work done via the task board and vice versa.
 * Both are searched with Postgres full-text search (free, no embeddings/API calls).
 */

const REMEMBER_RE = /^\s*(?:remember|note)\b[:,]?\s*(?:that\s+)?(.+)$/is;

/** If the message is a "remember ..." command, stores it and returns true. Otherwise false. */
export async function tryCaptureFromMessage(text: string, sourceChatId: string): Promise<boolean> {
  const m = REMEMBER_RE.exec(text.trim());
  if (!m || m[1].trim().length < 3) return false;
  await sql`INSERT INTO memories (id, content, source_chat_id) VALUES (${randomUUID()}, ${m[1].trim()}, ${sourceChatId})`;
  return true;
}

export async function listMemories() {
  return sql`SELECT id, content, created_at FROM memories ORDER BY created_at DESC LIMIT 200`;
}

export async function deleteMemory(id: string) {
  await sql`DELETE FROM memories WHERE id = ${id}`;
}

interface KnowledgeHit {
  kind: "memory" | "task" | "document";
  label: string;
  text: string;
}

/** plainto_tsquery ANDs every word — a natural question with one word absent from a short
 *  memory (e.g. "line", "what's") would zero-match even when the fact is clearly relevant.
 *  Build an OR query instead: match on ANY meaningful word, let ts_rank sort by relevance. */
function orQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)
    .slice(0, 16);
  if (words.length === 0) return null;
  return words.join(" | ");
}

/** Full-text search across memories, uploaded documents, and finished task deliverables. */
export async function searchKnowledge(query: string, limit = 5): Promise<string> {
  const tsq = orQuery(query.trim().slice(0, 200));
  if (!tsq) return "";
  try {
    const [memHits, docHits, taskHits] = await Promise.all([
      sql`
        SELECT content, ts_rank(to_tsvector('english', content), to_tsquery('english', ${tsq})) AS rank
        FROM memories
        WHERE to_tsvector('english', content) @@ to_tsquery('english', ${tsq})
        ORDER BY rank DESC LIMIT ${limit}`,
      sql`
        SELECT filename, content, ts_rank(to_tsvector('english', content), to_tsquery('english', ${tsq})) AS rank
        FROM documents
        WHERE to_tsvector('english', content) @@ to_tsquery('english', ${tsq})
        ORDER BY rank DESC LIMIT ${limit}`,
      sql`
        SELECT title, department, result,
               ts_rank(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(result,'')), to_tsquery('english', ${tsq})) AS rank
        FROM tasks
        WHERE status = 'done' AND to_tsvector('english', coalesce(title,'') || ' ' || coalesce(result,'')) @@ to_tsquery('english', ${tsq})
        ORDER BY rank DESC LIMIT ${limit}`,
    ]);

    const hits: KnowledgeHit[] = [
      ...(memHits as unknown as { content: string }[]).map((m) => ({ kind: "memory" as const, label: "remembered fact", text: m.content })),
      ...(docHits as unknown as { filename: string; content: string }[]).map((d) => ({
        kind: "document" as const,
        label: `uploaded file "${d.filename}"`,
        text: d.content.slice(0, 400),
      })),
      ...(taskHits as unknown as { title: string; department: string; result: string }[]).map((t) => ({
        kind: "task" as const,
        label: `past task "${t.title}" (${t.department})`,
        text: t.result.replace(/[#*_`]/g, "").slice(0, 300),
      })),
    ].slice(0, limit + 3);

    if (hits.length === 0) return "";
    return hits.map((h) => `- [${h.label}] ${h.text}`).join("\n");
  } catch {
    return ""; // FTS failure should never break a chat reply
  }
}
