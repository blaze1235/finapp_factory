import { GoogleGenAI } from "@google/genai";

type Provider = "groq" | "gemini";

// Free-tier Groq models, each with its OWN rate-limit bucket — if one is
// saturated mid-collab, the next still has headroom. Ordered fastest+best first.
const GROQ_MODEL_CHAIN = [
  process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
].filter((m, i, arr) => arr.indexOf(m) === i);

// Only reasoning-capable models accept reasoning_format — llama-3.x rejects it with a 400.
const REASONING_MODELS = new Set(["qwen/qwen3-32b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]);

// Multiple free Groq accounts — each with its own quota. Tried in order; a rate limit on the
// first key's models falls through to the second key's models before ever touching Gemini.
function groqKeys(): string[] {
  return [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter((k): k is string => !!k);
}

function providerOrder(): Provider[] {
  const env = process.env.LLM_PROVIDER;
  if (env) {
    return env
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter((p): p is Provider => p === "groq" || p === "gemini");
  }
  const list: Provider[] = [];
  if (groqKeys().length) list.push("groq");
  if (process.env.GEMINI_API_KEY) list.push("gemini");
  return list.length ? list : ["groq"];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Groq (OpenAI-compatible REST) ─────────────────────
async function groqCallOnce(apiKey: string, model: string, system: string, user: string, json: boolean): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: json ? 0.4 : 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // reasoning models (qwen3, gpt-oss) emit <think> blocks by default — hide them.
      // Non-reasoning models (llama-3.x) reject this param with a 400, so only send it when supported.
      ...(REASONING_MODELS.has(model) ? { reasoning_format: "hidden" } : {}),
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Groq/${model} ${res.status}: ${body.slice(0, 200)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const data = await res.json();
  return stripThinking(data?.choices?.[0]?.message?.content ?? "");
}

/** Belt-and-suspenders: strip any leaked chain-of-thought even if reasoning_format was ignored. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Tries every free Groq model across every configured key before giving up. */
async function groqCall(system: string, user: string, json: boolean): Promise<{ text: string; errors: string[] }> {
  const keys = groqKeys();
  if (keys.length === 0) return { text: "", errors: ["Groq: no GROQ_API_KEY set"] };
  const errors: string[] = [];
  for (let k = 0; k < keys.length; k++) {
    for (const model of GROQ_MODEL_CHAIN) {
      try {
        const out = await groqCallOnce(keys[k], model, system, user, json);
        if (out && out.trim()) return { text: out, errors };
        errors.push(`key${k + 1}/${model}: empty response`);
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        errors.push(`key${k + 1}/${model}: ${status ?? "?"} ${String((e as Error).message).slice(0, 100)}`);
        if (status === 429) {
          // brief backoff, then let the loop try the NEXT model (different bucket)
          await sleep(400);
        }
        // non-rate-limit error: still try the next model rather than aborting
      }
    }
  }
  return { text: "", errors };
}

// ── Gemini ────────────────────────────────────────────
let gemini: GoogleGenAI | null = null;
async function geminiCall(system: string, user: string, json: boolean): Promise<string> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  if (!gemini) gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await gemini.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: user }] }],
    config: {
      systemInstruction: system,
      temperature: json ? 0.4 : 0.7,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  });
  return res.text ?? "";
}

async function run(system: string, user: string, json: boolean): Promise<string> {
  const providers = providerOrder();
  const errors: string[] = [];
  for (const p of providers) {
    try {
      if (p === "groq") {
        const { text, errors: groqErrors } = await groqCall(system, user, json);
        if (text) return text;
        errors.push(`Groq[${groqErrors.join(" | ")}]`);
      } else {
        const text = await geminiCall(system, user, json);
        if (text && text.trim()) return text;
        errors.push("Gemini: empty response");
      }
    } catch (e) {
      errors.push(`Gemini: ${String((e as Error).message).slice(0, 150)}`);
    }
  }
  throw new Error(errors.join(" || ") || "No LLM provider available");
}

export async function generate(system: string, user: string): Promise<string> {
  return run(system, user, false);
}

export async function generateJson<T>(system: string, user: string): Promise<T> {
  const text = await run(system, user, true);
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Model returned non-JSON: ${text.slice(0, 200)}`);
  }
}
