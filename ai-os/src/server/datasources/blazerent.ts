import { readonlyQuery, isConfigured } from "./connector";

/**
 * Queries grounded in BlazeRent's real schema (SQLAlchemy models the developer shared:
 * users, orders, transactions, steam_accounts, clubs, club_ledger_entries, complaints).
 * Untested against a live connection — the given connection string used a Docker-internal
 * hostname (`db`) that doesn't resolve externally. Verify the first real query once a
 * reachable connection string is set as BLAZERENT_DATABASE_URL.
 */

function clampDays(n: number): number {
  return Math.min(Math.max(Math.floor(n) || 30, 1), 365);
}

export async function getNewUsers(windowDays = 30) {
  const rows = await readonlyQuery(
    "blazerent",
    `SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS new_users
     FROM users
     WHERE created_at >= now() - interval '${clampDays(windowDays)} days'
     GROUP BY 1 ORDER BY 1`,
  );
  return rows as unknown as { day: string; new_users: number }[];
}

export async function getRevenue(windowDays = 30) {
  const rows = await readonlyQuery(
    "blazerent",
    `SELECT date_trunc('day', paid_at)::date AS day, sum(paid_amount)::numeric AS revenue, count(*)::int AS orders
     FROM orders
     WHERE status = 'completed' AND paid_at >= now() - interval '${clampDays(windowDays)} days'
     GROUP BY 1 ORDER BY 1`,
  );
  return (rows as unknown as { day: string; revenue: string; orders: number }[]).map((r) => ({
    day: r.day,
    revenue: Number(r.revenue),
    orders: r.orders,
  }));
}

export async function getAccountUtilization() {
  const rows = await readonlyQuery(
    "blazerent",
    `SELECT status, count(*)::int AS count FROM steam_accounts GROUP BY status ORDER BY count DESC`,
  );
  return rows as unknown as { status: string; count: number }[];
}

/** Rolling 30-day retention: of users with a completed order 30-60 days ago, how many also ordered in the last 30 days. */
export async function getRetention() {
  const rows = await readonlyQuery(
    "blazerent",
    `WITH prior AS (
       SELECT DISTINCT user_id FROM orders
       WHERE status = 'completed' AND paid_at >= now() - interval '60 days' AND paid_at < now() - interval '30 days'
     ), current_period AS (
       SELECT DISTINCT user_id FROM orders
       WHERE status = 'completed' AND paid_at >= now() - interval '30 days'
     )
     SELECT
       (SELECT count(*) FROM prior)::int AS prior_active,
       (SELECT count(*) FROM prior p JOIN current_period c ON c.user_id = p.user_id)::int AS retained`,
  );
  const [row] = rows as unknown as { prior_active: number; retained: number }[];
  if (!row || row.prior_active === 0) return { priorActive: 0, retained: 0, retentionPct: null as number | null };
  return { priorActive: row.prior_active, retained: row.retained, retentionPct: (row.retained / row.prior_active) * 100 };
}

export async function getTopClubs(limit = 5) {
  const rows = await readonlyQuery(
    "blazerent",
    `SELECT c.name, sum(l.revenue)::numeric AS revenue, count(*)::int AS orders
     FROM club_ledger_entries l JOIN clubs c ON c.id = l.club_id
     WHERE l.order_created_at >= now() - interval '30 days'
     GROUP BY c.name ORDER BY revenue DESC LIMIT ${Math.min(Math.max(limit, 1), 20)}`,
  );
  return (rows as unknown as { name: string; revenue: string; orders: number }[]).map((r) => ({
    name: r.name,
    revenue: Number(r.revenue),
    orders: r.orders,
  }));
}

export async function getOpenComplaints() {
  const rows = await readonlyQuery(
    "blazerent",
    `SELECT reason, count(*)::int AS count FROM complaints WHERE status = 'open' GROUP BY reason ORDER BY count DESC`,
  );
  return rows as unknown as { reason: string; count: number }[];
}

let cached: { at: number; text: string } | null = null;

/** Compact live-data grounding string for an agent's system prompt. Cheap enough per chat turn; cached briefly. */
export async function snapshot(): Promise<string | null> {
  if (!isConfigured("blazerent")) return null;
  if (cached && Date.now() - cached.at < 2 * 60_000) return cached.text;
  try {
    const [newUsers, revenue, utilization, retention, complaints] = await Promise.all([
      getNewUsers(30),
      getRevenue(30),
      getAccountUtilization(),
      getRetention(),
      getOpenComplaints(),
    ]);
    const totalNewUsers = newUsers.reduce((s, r) => s + r.new_users, 0);
    const totalRevenue = revenue.reduce((s, r) => s + r.revenue, 0);
    const totalOrders = revenue.reduce((s, r) => s + r.orders, 0);
    const util = utilization.map((u) => `${u.status}:${u.count}`).join(", ") || "no data";
    const complaintsLine = complaints.length ? complaints.map((c) => `${c.reason}:${c.count}`).join(", ") : "none open";
    const text = [
      `LIVE BlazeRent data (last 30 days, pulled just now — use these real numbers, don't estimate):`,
      `- New users: ${totalNewUsers}`,
      `- Completed orders: ${totalOrders}, revenue: ${totalRevenue.toLocaleString()} UZS`,
      `- Account status breakdown: ${util}`,
      `- 30d retention: ${retention.retentionPct !== null ? retention.retentionPct.toFixed(1) + "%" : "n/a"} (${retention.retained}/${retention.priorActive} returning)`,
      `- Open complaints: ${complaintsLine}`,
    ].join("\n");
    cached = { at: Date.now(), text };
    return text;
  } catch (e) {
    return `(BlazeRent DB is connected but a query failed: ${String(e).slice(0, 150)} — mention this rather than guessing numbers.)`;
  }
}
