// The client's entire world. Every read here goes through the v_client_* views,
// which expose a listed set of columns and still run under RLS — so this file
// physically cannot serve an internal deadline, an internal comment or an
// unpaid invoice, however it is edited later.
const express = require('express');

module.exports = ({ auth, only, wrap, notifyStaff, notifyScope }) => {
  const r = express.Router();
  r.use(auth, only('client'));

  r.get('/', wrap(async (req, res) => {
    const data = await req.q(async c => {
      const q = (t, p) => c.query(t, p).then(x => x.rows);
      const [company] = await q(`SELECT id, name, contact_name FROM companies WHERE id=$1`, [req.user.company_id]);
      const projects = await q(`SELECT * FROM v_client_projects ORDER BY due NULLS LAST, id`);
      const tasks    = await q(`SELECT * FROM v_client_tasks ORDER BY needs_you DESC, due NULLS LAST, id`);
      // Activity without actor names, for the same reason.
      const activity = await q(
        `SELECT verb, detail, created_at, project_id FROM activity
          ORDER BY created_at DESC LIMIT 20`);
      const phases = await q(`SELECT * FROM v_client_phases ORDER BY position, starts_on NULLS LAST`);
      const documents = await q(`SELECT * FROM v_client_documents ORDER BY created_at DESC`);
      return { company, projects, tasks, activity, phases, documents };
    });
    data.awaiting = data.tasks.filter(t => t.needs_you);
    res.json(data);
  }));

  // The client's own Gantt: same shape as the internal one, built only from
  // v_client_* views, so it carries client dates and no internal ones.
  r.get('/gantt', wrap(async (req, res) => {
    const { buildColumns } = require('./calendar');
    const settings = await req.sql(`SELECT value FROM settings WHERE key='working_days'`)
      .then(r2 => (r2[0]?.value || 'mon,tue,wed,thu,fri').split(',').map(x => x.trim()))
      .catch(() => ['mon', 'tue', 'wed', 'thu', 'fri']);

    const out = await req.q(async c => {
      const q = (t, p) => c.query(t, p).then(x => x.rows);
      const projects = await q(`SELECT * FROM v_client_projects ORDER BY due NULLS LAST, id`);
      const phases = await q(`SELECT * FROM v_client_phases ORDER BY project_id, position, id`);
      const tasks = await q(
        `SELECT t.*, client_state(tk.status, t.is_meeting) AS state
           FROM v_client_tasks t JOIN tasks tk ON tk.id = t.id
          ORDER BY t.project_id, t.id`);
      return { projects, phases, tasks };
    });

    const dates = [];
    for (const t of out.tasks) { if (t.starts) dates.push(t.starts); if (t.due) dates.push(t.due); }
    for (const p of out.phases) { if (p.starts_on) dates.push(p.starts_on); if (p.ends_on) dates.push(p.ends_on); }
    for (const p of out.projects) { if (p.starts_on) dates.push(p.starts_on); if (p.due) dates.push(p.due); }
    const today = new Date().toISOString().slice(0, 10);
    dates.push(today);
    const iso = dates.map(d => String(d).slice(0, 10)).sort();
    const pad = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

    res.json({
      ...out,
      columns: buildColumns(pad(iso[0], -3), pad(iso[iso.length - 1], 3), settings),
      today,
    });
  }));

  r.get('/tasks/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = await req.q(async c => {
      const q = (t, p) => c.query(t, p).then(x => x.rows);
      const [task] = await q(`SELECT * FROM v_client_tasks WHERE id=$1`, [id]);
      if (!task) return null;
      const comments = await q(`SELECT * FROM v_client_comments WHERE task_id=$1 ORDER BY created_at`, [id]);
      const files = await q(`SELECT * FROM v_client_files WHERE task_id=$1 ORDER BY created_at DESC`, [id]);
      const approvals = await q(`SELECT * FROM v_client_approvals WHERE task_id=$1 ORDER BY decided_at DESC`, [id]);
      return { task, comments, files, approvals };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(out);
  }));

  // The only write a client has. There is no comment box on purpose: feedback
  // that arrives outside this endpoint is feedback that never gets counted,
  // and the counting is the product.
  r.post('/tasks/:id/decision', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { decision, note } = req.body || {};
    if (!['approved', 'changes_requested'].includes(decision))
      return res.status(400).json({ error: 'Choose approve or request changes' });
    if (decision === 'changes_requested' && !String(note || '').trim())
      return res.status(400).json({ error: 'Please say what needs changing' });

    const out = await req.q(async c => {
      const t = await c.query(`SELECT id, version, needs_you, title FROM v_client_tasks WHERE id=$1`, [id]);
      if (!t.rows.length) return { error: 404 };
      if (!t.rows[0].needs_you) return { error: 409 };
      const a = await c.query(
        `INSERT INTO approvals(task_id,version_no,decision,decided_by,decided_by_name,note,source)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, t.rows[0].version || 1, decision, req.user.id, req.user.name,
         String(note || '').trim(), req.body.source === 'telegram' ? 'telegram' : 'portal']);
      // The trigger stamps the alert with this approval's id, so this finds
      // exactly the one this decision caused — no timestamp guessing.
      const scope = await c.query(
        `SELECT s.*, p.name AS project, tk.title AS task, p.owner_id
           FROM scope_alerts s JOIN projects p ON p.id=s.project_id
           JOIN tasks tk ON tk.id=s.task_id WHERE s.approval_id=$1`, [a.rows[0].id]);
      return { approval: a.rows[0], title: t.rows[0].title, scope: scope.rows[0] || null };
    });
    if (out.error === 404) return res.status(404).json({ error: 'Not found' });
    if (out.error === 409) return res.status(409).json({ error: 'This is not waiting on you right now' });

    notifyStaff({ tenantId: req.user.tenant_id, kind: 'decision',
                  payload: { decision, title: out.title, who: req.user.name, note } }).catch(() => {});
    if (out.scope)
      notifyScope({ tenantId: req.user.tenant_id, alert: out.scope,
                    project: out.scope.project, task: out.scope.task }).catch(() => {});
    res.json(out.approval);
  }));

  return r;
};
