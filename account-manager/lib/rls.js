// The only sanctioned way to touch a tenant database.
//
// Postgres superusers bypass row level security outright — and on Railway the
// app's own DATABASE_URL is a superuser — so applying the policies in
// schema.sql requires deliberately dropping to the unprivileged `am_app` role
// for the duration of each request. That, plus the three session settings the
// policies read, is all this file does.
//
// Everything is scoped to a transaction (`SET LOCAL`, `set_config(..., true)`),
// so a pooled connection cannot carry one person's identity into the next
// person's request even if a handler throws halfway through.

async function withRls(pool, ctx, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.role',    $2, true),
              set_config('app.company_id', $3, true)`,
      [
        ctx.userId == null ? '' : String(ctx.userId),
        ctx.role || '',
        ctx.companyId == null ? '' : String(ctx.companyId),
      ]);
    await client.query('SET LOCAL ROLE am_app');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Escalated access for the few jobs that are genuinely the system's and not a
// person's: nightly digests, the weekly report, Telegram fan-out. Still a
// transaction, still am_app — it just claims the owner's view. Never reachable
// from an HTTP route.
function asSystem(pool, fn) {
  return withRls(pool, { userId: null, role: 'owner', companyId: null }, fn);
}

module.exports = { withRls, asSystem };
