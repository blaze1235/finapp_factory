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
    return {
      period_days: days,
      shipped, slipped, waiting,
      revisions: revisions[0] || { rounds: 0, on_tasks: 0 },
      scope, by_client: byClient,
      generated_at: new Date().toISOString(),
    };
  });
}

module.exports = ({ auth, only, wrap }) => {
  const r = express.Router();
  r.use(auth);

  r.get('/weekly', only('owner', 'accountant'), wrap(async (req, res) => {
    res.json(await weeklyReport(req.q, { days: Number(req.query.days) || 7 }));
  }));

  // A teammate's own week, and nobody else's.
  r.get('/my-week', only('teammate', 'owner'), wrap(async (req, res) => {
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
