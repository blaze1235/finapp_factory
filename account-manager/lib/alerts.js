// Proactive alerts. Each condition is deduped through alerts_fired so a
// standing problem nags once a day rather than every run.
const COOLDOWN_HOURS = 20;

async function fireOnce(c, key, role, userId, title, body, kind, params) {
  const recent = await c.query(
    `SELECT 1 FROM alerts_fired WHERE key=$1 AND fired_at > now() - ($2 || ' hours')::interval`,
    [key, COOLDOWN_HOURS]);
  if (recent.rows.length) return false;
  await c.query(`INSERT INTO alerts_fired(key, fired_at) VALUES($1, now())
                 ON CONFLICT (key) DO UPDATE SET fired_at = now()`, [key]);
  await c.query(
    `INSERT INTO notifications(user_id, role, title, body, kind, params) VALUES($1,$2,$3,$4,$5,$6)`,
    [userId, role, title, body, kind, params || {}]);
  return true;
}

async function runAlerts(asSystem, pool) {
  return asSystem(pool, async c => {
    let fired = 0;

    // 1. A deliverable is late against the internal date — while there is still
    //    padding left before the client's date, which is the point of having two.
    for (const t of (await c.query(
      `SELECT t.id, t.title, t.assignee_id, t.due_date, t.client_due_date, p.name AS project
         FROM tasks t JOIN projects p ON p.id=t.project_id
        WHERE t.status NOT IN ('approved','completed')
          AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE`)).rows) {
      if (await fireOnce(c, `late:${t.id}:${t.due_date}`, 'teammate', t.assignee_id,
        'Past its internal date', `"${t.title}" (${t.project}) was due ${t.due_date}.`, 'deadline',
        { event: 'task_late', task: t.title, project: t.project, due: t.due_date })) fired++;
    }

    // 2. Sitting with a client for a week. "Waiting on the client" is a real
    //    status, but it should never be a quiet one.
    for (const t of (await c.query(
      `SELECT t.id, t.title, co.name AS company,
              EXTRACT(day FROM now() - COALESCE(
                (SELECT MAX(sent_at) FROM task_versions v WHERE v.task_id=t.id), t.created_at))::int AS days
         FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
        WHERE t.status='awaiting_client'`)).rows) {
      if (t.days >= 7 && await fireOnce(c, `stale:${t.id}:${Math.floor(t.days / 7)}`, 'owner', null,
        'Waiting on a client', `"${t.title}" has been with ${t.company} for ${t.days} days.`, 'approval',
        { event: 'awaiting_client', task: t.title, company: t.company, days: t.days })) fired++;
    }

    // 3. An undecided scope alert is money in limbo — the one thing this
    //    product exists to stop going quiet.
    for (const s of (await c.query(
      `SELECT s.id, s.revision_round, t.title, p.name AS project, p.owner_id,
              EXTRACT(day FROM now() - s.created_at)::int AS days
         FROM scope_alerts s JOIN tasks t ON t.id=s.task_id JOIN projects p ON p.id=s.project_id
        WHERE s.resolution='pending'`)).rows) {
      if (s.days >= 2 && await fireOnce(c, `scope:${s.id}:${Math.floor(s.days / 2)}`, 'owner', s.owner_id,
        'Undecided extra scope', `Round ${s.revision_round} on "${s.title}" is still undecided after ${s.days} days.`,
        'scope', { event: 'scope_undecided', task: s.title, round: s.revision_round, days: s.days })) fired++;
    }

    return fired;
  });
}

module.exports = { runAlerts };
