import { readonlyQuery, isConfigured } from "./connector";

/**
 * Queries verified against Finly's LIVE production DB (introspected 2026-07-11: 152 users,
 * 1557 transactions). Known-column queries use the schema from api/main.py in blaze1235/finly;
 * tables that exist only in the deployed version (personal_debts, savings_jars, shared_goals,
 * social_debts, donations, friends) are counted column-agnostically via count(*).
 */

const OWNER_ID = () => process.env.FINLY_OWNER_ID || "1398614118"; // @aa_sobirjonov (Abdulaziz)

async function count(table: string): Promise<number> {
  // table names are from a fixed internal list — never user input
  const rows = await readonlyQuery("finly", `SELECT count(*)::int AS n FROM ${table}`);
  return (rows[0]?.n as number) ?? 0;
}

async function activeUsers(days: number): Promise<number> {
  const rows = await readonlyQuery(
    "finly",
    `SELECT count(DISTINCT user_id)::int AS n FROM transactions WHERE created_at >= now() - interval '${days} days'`,
  );
  return (rows[0]?.n as number) ?? 0;
}

/** App-wide product metrics for the Finly & Monetization team. */
export async function appSnapshot(): Promise<string | null> {
  if (!isConfigured("finly")) return null;
  try {
    const [totalUsers, newUsers30, active7, active30, tx30, features] = await Promise.all([
      count("users"),
      readonlyQuery("finly", `SELECT count(*)::int AS n FROM users WHERE created_at >= now() - interval '30 days'`).then(
        (r) => (r[0]?.n as number) ?? 0,
      ),
      activeUsers(7),
      activeUsers(30),
      readonlyQuery(
        "finly",
        `SELECT count(*)::int AS n, count(DISTINCT user_id)::int AS u FROM transactions WHERE created_at >= now() - interval '30 days'`,
      ).then((r) => r[0] as { n: number; u: number }),
      Promise.all(
        (
          [
            ["budgets", "budgets"],
            ["personal_goals", "goals"],
            ["savings_jars", "savings jars"],
            ["personal_debts", "personal debts"],
            ["social_debts", "shared debts"],
            ["shared_goals", "shared goals"],
            ["donations", "donations"],
            ["friends", "friend links"],
          ] as const
        ).map(async ([table, label]) => `${label}:${await count(table).catch(() => 0)}`),
      ),
    ]);
    return [
      `LIVE Finly product data (production DB, pulled just now — use these real numbers, never invent):`,
      `- Total users: ${totalUsers} (+${newUsers30} in last 30d)`,
      `- Users logging transactions: ${active7} in last 7d, ${active30} in last 30d`,
      `- Transactions last 30d: ${tx30.n} by ${tx30.u} users`,
      `- Feature adoption (total rows): ${features.join(", ")}`,
    ].join("\n");
  } catch (e) {
    return `(Finly DB connected but a query failed: ${String(e).slice(0, 140)} — say so, don't guess.)`;
  }
}

/** Abdulaziz's personal finances for the Finance & Analytics team. */
export async function personalSnapshot(): Promise<string | null> {
  if (!isConfigured("finly")) return null;
  try {
    const owner = OWNER_ID();
    const [totals, topCats, budgets] = await Promise.all([
      readonlyQuery(
        "finly",
        `SELECT type, currency, sum(amount)::bigint AS total, count(*)::int AS n
         FROM transactions WHERE user_id = ${Number(owner)} AND date_str >= (CURRENT_DATE - interval '30 days')
         GROUP BY type, currency ORDER BY total DESC`,
      ),
      readonlyQuery(
        "finly",
        `SELECT cat_name, sum(amount)::bigint AS total, count(*)::int AS n
         FROM transactions WHERE user_id = ${Number(owner)} AND type = 'expense' AND date_str >= (CURRENT_DATE - interval '30 days')
         GROUP BY cat_name ORDER BY total DESC LIMIT 6`,
      ),
      readonlyQuery(
        "finly",
        `SELECT b.name, b.limit_amt::bigint AS limit_amt,
                COALESCE((SELECT sum(t.amount) FROM transactions t
                  WHERE t.user_id = b.user_id AND t.type = 'expense' AND t.cat_name = b.name
                    AND date_trunc('month', t.date_str) = date_trunc('month', CURRENT_DATE)), 0)::bigint AS spent
         FROM budgets b WHERE b.user_id = ${Number(owner)}`,
      ),
    ]);
    const totalsLine = totals.length
      ? (totals as { type: string; currency: string; total: string; n: number }[])
          .map((t) => `${t.type} ${Number(t.total).toLocaleString()} ${t.currency} (${t.n} tx)`)
          .join("; ")
      : "no transactions in the last 30 days";
    const catsLine = topCats.length
      ? (topCats as { cat_name: string; total: string }[])
          .map((c) => `${c.cat_name || "uncategorized"}: ${Number(c.total).toLocaleString()}`)
          .join(", ")
      : "none";
    const budgetLine = budgets.length
      ? (budgets as { name: string; limit_amt: string; spent: string }[])
          .map((b) => `${b.name} ${Number(b.spent).toLocaleString()}/${Number(b.limit_amt).toLocaleString()}`)
          .join(", ")
      : "no budgets set";
    return [
      `LIVE personal finance data for Abdulaziz from Finly (last 30 days, pulled just now — real numbers, never invent):`,
      `- Totals: ${totalsLine}`,
      `- Top expense categories: ${catsLine}`,
      `- Budgets this month (spent/limit): ${budgetLine}`,
    ].join("\n");
  } catch (e) {
    return `(Finly DB connected but a personal-finance query failed: ${String(e).slice(0, 140)} — say so, don't guess.)`;
  }
}
