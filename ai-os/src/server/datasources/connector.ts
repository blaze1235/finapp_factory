import postgres from "postgres";

/**
 * Read-only connectors to the user's OTHER apps (BlazeRent, Finly, Bika — each its own
 * Postgres, built/hosted separately from ai-os). Each is gated by its own env var and is a
 * complete no-op until that var is set — safe to import everywhere.
 *
 * Once a connection string is added, the actual metric queries (retention, revenue, feature
 * usage…) still need to be written against that app's REAL schema — nothing here guesses
 * column/table names. Use listTables()/tableColumns() to inspect the live schema first.
 */
export type SourceKey = "blazerent" | "finly" | "bika";

const ENV_VAR: Record<SourceKey, string> = {
  blazerent: "BLAZERENT_DATABASE_URL",
  finly: "FINLY_DATABASE_URL",
  bika: "BIKA_DATABASE_URL",
};

declare global {
  // eslint-disable-next-line no-var
  var __aios_datasources: Partial<Record<SourceKey, ReturnType<typeof postgres>>> | undefined;
}

function pool() {
  if (!globalThis.__aios_datasources) globalThis.__aios_datasources = {};
  return globalThis.__aios_datasources;
}

export function isConfigured(source: SourceKey): boolean {
  return !!process.env[ENV_VAR[source]];
}

function client(source: SourceKey) {
  const p = pool();
  if (!p[source]) {
    const url = process.env[ENV_VAR[source]];
    if (!url) throw new Error(`${ENV_VAR[source]} is not set`);
    p[source] = postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 5, onnotice: () => {} });
  }
  return p[source]!;
}

const WRITE_KEYWORDS = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|call|do)\b/i;

/**
 * Runs a read-only SELECT against a connected app's database. Rejects anything that isn't a
 * plain SELECT (defense in depth — the DB user itself should also be provisioned read-only).
 */
export async function readonlyQuery(source: SourceKey, query: string, limit = 200) {
  if (!isConfigured(source)) throw new Error(`${source} is not connected yet — no ${ENV_VAR[source]} set`);
  const trimmed = query.trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(trimmed)) throw new Error("Only SELECT queries are allowed");
  if (WRITE_KEYWORDS.test(trimmed)) throw new Error("Query contains a disallowed keyword");
  const capped = /\blimit\b/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${Math.min(Math.max(limit, 1), 500)}`;
  return client(source).unsafe(capped);
}

export async function listTables(source: SourceKey) {
  if (!isConfigured(source)) return [];
  return client(source)`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name`;
}

export async function tableColumns(source: SourceKey, table: string) {
  if (!isConfigured(source)) return [];
  return client(source)`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position`;
}

/** Cheap, safe grounding: what tables exist, if any. Cached briefly so chats don't re-introspect every message. */
const tableCache: Partial<Record<SourceKey, { at: number; tables: string[] }>> = {};
export async function tableSummary(source: SourceKey): Promise<string[] | null> {
  if (!isConfigured(source)) return null;
  const cached = tableCache[source];
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.tables;
  try {
    const rows = (await listTables(source)) as unknown as { table_name: string }[];
    const tables = rows.map((r) => r.table_name);
    tableCache[source] = { at: Date.now(), tables };
    return tables;
  } catch {
    return null;
  }
}
