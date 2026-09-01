// The weekly report measures the agency, not individuals: what shipped, what
// slipped, what is sitting with clients, how many revision rounds got burned.
// There are deliberately no per-person productivity counts — a teammate asking
// for their own week gets only their own.
const express = require('express');

async function weeklyReport(runner, { days = 7 } = {}) {
  return runner(async c => {
    const q = (t, p) => c.query(t, p).then(x => x.rows);
    const since = `now() - interval '${Number(days)} days'`;
    // Sequential: one client, one RLS transaction, one query at a time.
    const shipped = await q(`SELECT t.id, t.title, p.name AS project, co.name AS company, t.completed_at
           FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
          WHERE t.status IN ('approved','completed') AND t.completed_at >= ${since}
          ORDER BY t.completed_at DESC`);
    const slipped = await q(`SELECT t.id, t.title, t.due_date, p.name AS project, co.name AS company,
                (CURRENT_DATE - t.due_date) AS days_late
           FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
          WHERE t.status NOT IN ('approved','completed') AND t.due_date < CURRENT_DATE
          ORDER BY t.due_date`);
    const waiting = await q(`SELECT t.id, t.title, co.name AS company,
                EXTRACT(day FROM now() - COALESCE(
                  (SELECT MAX(sent_at) FROM task_versions v WHERE v.task_id=t.id), t.created_at))::int AS days_waiting
           FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
          WHERE t.status='awaiting_client' ORDER BY days_waiting DESC`);
    const revisions = await q(`SELECT count(*)::int AS rounds,
                count(DISTINCT a.task_id)::int AS on_tasks
           FROM approvals a WHERE a.decision='changes_requested' AND a.decided_at >= ${since}`);
    const scope = await q(`SELECT resolution, count(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS amount
           FROM scope_alerts WHERE created_at >= ${since} GROUP BY resolution`);
    const byClient = await q(`SELECT co.name AS company,
                count(*) FILTER (WHERE t.status IN ('approved','completed') AND t.completed_at >= ${since})::int AS shipped,
                count(*) FILTER (WHERE t.status='awaiting_client')::int AS waiting,
                count(*) FILTER (WHERE t.status NOT IN ('approved','completed') AND t.due_date < CURRENT_DATE)::int AS late
           FROM companies co
           JOIN projects p ON p.company_id=co.id
           JOIN tasks t ON t.project_id=p.id
          GROUP BY co.name HAVING count(*) > 0 ORDER BY shipped DESC`);
    // "Progress moved" (§10): where each project stood at the start of the week
    // versus now. The earlier number has to have been written down, which is
    // what progress_snapshots is for — snapshotWeek() runs on the daily tick.
    const progressMoved = await q(`
      SELECT p.id, p.name, co.name AS company,
             COALESCE(s.pct, 0) AS was, pr.pct AS now
        FROM projects p
        JOIN companies co ON co.id = p.company_id
        CROSS JOIN LATERAL project_progress(p.id) pr
        LEFT JOIN progress_snapshots s
               ON s.project_id = p.id AND s.week_start = date_trunc('week', CURRENT_DATE)::date
       WHERE NOT p.archived ORDER BY (pr.pct - COALESCE(s.pct,0)) DESC`);

    // Revision rounds used against what the scope allowed, flagged when over.
    const revisionUsage = await q(`
      SELECT p.id, p.name, co.name AS company, p.revisions_included,
             COALESCE(MAX(t.revision_round), 0) AS used,
             COALESCE(MAX(t.revision_round), 0) > p.revisions_included AS over
        FROM projects p
        JOIN companies co ON co.id = p.company_id
        LEFT JOIN tasks t ON t.project_id = p.id
       WHERE NOT p.archived
       GROUP BY p.id, co.name ORDER BY over DESC, used DESC`);

    // Shipped versus slipped over six weeks, for the bar chart.
    const trend = await q(`
      SELECT to_char(w.week, 'MM-DD') AS week,
             (SELECT count(*) FROM tasks t
               WHERE t.completed_at >= w.week AND t.completed_at < w.week + interval '7 days')::int AS shipped,
             (SELECT count(*) FROM tasks t
               WHERE t.due_date >= w.week::date AND t.due_date < (w.week + interval '7 days')::date
                 AND (t.completed_at IS NULL OR t.completed_at::date > t.due_date))::int AS slipped
        FROM generate_series(date_trunc('week', CURRENT_DATE) - interval '5 weeks',
                             date_trunc('week', CURRENT_DATE), interval '1 week') AS w(week)
       ORDER BY w.week`);

    // Money, on the two bases the finance page uses.
    const money = (await q(`
      SELECT COALESCE(SUM(amount) FILTER (WHERE direction='in'),0)::bigint AS invoiced,
             COALESCE(SUM(amount) FILTER (WHERE direction='in' AND settled),0)::bigint AS received
        FROM transactions WHERE period >= date_trunc('month', CURRENT_DATE)::date`))[0];

    const rev = revisions[0] || { rounds: 0, on_tasks: 0 };
    return {
      period_days: days,
      // The one-sentence summary the spec asks for, assembled from the numbers
      // rather than written by hand so it can never disagree with them.
      summary: {
        shipped: shipped.length, slipped: slipped.length,
        waiting: waiting.length, revision_rounds: rev.rounds,
      },
      shipped, slipped, waiting,
      revisions: rev,
      progress_moved: progressMoved,
      revision_usage: revisionUsage,
      trend, money,
      scope, by_client: byClient,
      generated_at: new Date().toISOString(),
    };
  });
}

// Writes down where every project stands, once per week. Without this the
// "progress moved" panel has nothing to compare against — you cannot
// reconstruct last Monday's percentage after the fact.
async function snapshotWeek(runner) {
  return runner(async c => {
    const { rowCount } = await c.query(`
      INSERT INTO progress_snapshots(project_id, week_start, pct)
      SELECT p.id, date_trunc('week', CURRENT_DATE)::date, pr.pct
        FROM projects p CROSS JOIN LATERAL project_progress(p.id) pr
       WHERE NOT p.archived
      ON CONFLICT (project_id, week_start) DO NOTHING`);
    return rowCount;
  });
}

module.exports = ({ auth, only, wrap }) => {
  const r = express.Router();
  r.use(auth);

  r.get('/weekly', only('owner', 'accountant'), wrap(async (req, res) => {
    res.json(await weeklyReport(req.q, { days: Number(req.query.days) || 7 }));
  }));

  // A teammate's own week, and nobody else's.
  r.get('/my-week', only('teammate', 'owner', 'editor'), wrap(async (req, res) => {
    const me = req.user.id;
    res.json(await req.q(async c => {
      const q = (t, p) => c.query(t, p).then(x => x.rows);
      const done = await q(`SELECT t.id,t.title,t.completed_at,p.name AS project FROM tasks t JOIN projects p ON p.id=t.project_id
            WHERE t.assignee_id=$1 AND t.status IN ('approved','completed')
              AND t.completed_at >= now() - interval '7 days' ORDER BY t.completed_at DESC`, [me]);
      const open = await q(`SELECT t.id,t.title,t.status,t.due_date,t.revision_round,p.name AS project
             FROM tasks t JOIN projects p ON p.id=t.project_id
            WHERE t.assignee_id=$1 AND t.status NOT IN ('approved','completed')
            ORDER BY t.due_date NULLS LAST`, [me]);
      const incoming = await q(`SELECT t.id,t.title,t.due_date,p.name AS project FROM tasks t JOIN projects p ON p.id=t.project_id
            WHERE t.assignee_id=$1 AND t.status='todo' AND t.due_date <= CURRENT_DATE + 7
            ORDER BY t.due_date`, [me]);
      return { done, open, incoming };
    }));
  }));

  return r;
};
module.exports.weeklyReport = weeklyReport;
module.exports.snapshotWeek = snapshotWeek;
