import type { Worker } from "./registry";
import { snapshot as blazerentSnapshot } from "@/server/datasources/blazerent";
import { appSnapshot as finlyAppSnapshot, personalSnapshot as finlyPersonalSnapshot } from "@/server/datasources/finly";
import { searchKnowledge } from "./knowledge";

/** Shared by both the task orchestrator and the chat system so tasks and chats draw on the
 *  same real data and the same team memory — no more siloed knowledge between the two. */

export const GROUNDING =
  "HARD RULE on numbers: you may state a specific number ONLY if it comes from (a) a LIVE data block above, (b) the TEAM KNOWLEDGE block above, or (c) something Abdulaziz said earlier in this exact conversation. If none of those give you the number you need, do NOT invent one — say plainly \"I don't have real numbers for that\" and either ask Abdulaziz for it or state a qualitative view without fake precision. This applies to revenue, users, market size, percentages, dates — everything. Violating this is worse than saying \"I don't know.\"";

/** Real live-data grounding for a worker, if their department has a connected source. No-op until configured. */
export async function liveDataFor(w: Worker): Promise<string> {
  let data: string | null = null;
  if (w.dept === "blazerent") data = await blazerentSnapshot();
  else if (w.dept === "finly") data = await finlyAppSnapshot();
  else if (w.dept === "finance") data = await finlyPersonalSnapshot();
  return data ? `\n\n${data}` : "";
}

/** Team memory + past-task deliverables relevant to what's being discussed right now. */
export async function knowledgeFor(query: string): Promise<string> {
  const hits = await searchKnowledge(query);
  return hits ? `\n\nTEAM KNOWLEDGE (from memory and past task deliverables — cite if relevant):\n${hits}` : "";
}
