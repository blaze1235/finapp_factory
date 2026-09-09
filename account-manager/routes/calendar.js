// Calendar / Timeline (§6).
//
// Two levels. Across all projects, one bar per project with a delivery marker.
// Inside a project, the bars are its phases — which the owner edits, because a
// phase breakdown that nobody can change is a phase breakdown that goes stale
// in a fortnight.
const express = require('express');

// The client's reference sheet skips Saturday and Sunday entirely, which is
// what keeps nine weeks readable on one screen. Working days come from
// settings, so an agency that works Saturdays gets Saturdays.
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function buildColumns(from, to, workingDays) {
  const cols = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  // A guard rather than a promise: a mistyped range should not build a
  // hundred thousand columns and hang the browser.
  let guard = 0;
  while (cur <= end && guard++ < 800) {
    const key = DAY_KEYS[cur.getUTCDay()];
    if (workingDays.includes(key)) {
      const iso = cur.toISOString().slice(0, 10);
      cols.push({
        date: iso,
        dow: key,
        // ISO week, so the week header groups the same way a planner does.
        week: isoWeek(cur),
        month: iso.slice(0, 7),
      });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return cols;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
}

// The span a row occupies. A task with only a due date is a single day, which
// is how a milestone or a presentation reads on their sheet.
const spanOf = (start, end) => {
  const s = start || end, e = end || start;
  return s && e ? { from: String(s).slice(0, 10), to: String(e).slice(0, 10) } : null;
};

module.exports = ({ auth, only, wrap, getNameMap, readSettings }) => {
  const r = express.Router();
  r.use(auth, only('owner', 'accountant', 'teammate', 'editor'));

  r.get('/', wrap(async (req, res) => {
    const rows = await req.sql(`
      SELECT p.id, p.name, p.stage, p.starts_on, p.due_date, p.client_due_date, p.archived,
             co.name AS company_name,
             pr.pct, pr.done, pr.total,
             ARRAY(SELECT m.user_id FROM project_members m WHERE m.project_id=p.id) AS member_ids,
             (SELECT min(ph.starts_on) FROM project_phases ph WHERE ph.project_id=p.id) AS phase_start,
             (SELECT max(ph.ends_on)   FROM project_phases ph WHERE ph.project_id=p.id) AS phase_end
        FROM projects p JOIN companies co ON co.id=p.company_id
        CROSS JOIN LATERAL project_progress(p.id) pr
       WHERE NOT p.archived ORDER BY p.starts_on NULLS LAST, p.id`);
    const names = await getNameMap(req.user.tenant_id);
    res.json(rows.map(p => ({ ...p, members: (p.member_ids || []).map(i => names.get(i)).filter(Boolean) })));
  }));

  r.get('/projects/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = await req.q(async c => {
      const [project] = (await c.query(
        `SELECT p.id, p.name, p.stage, p.starts_on, p.due_date, p.client_due_date, co.name AS company_name
           FROM projects p JOIN companies co ON co.id=p.company_id WHERE p.id=$1`, [id])).rows;
      if (!project) return null;
      const phases = (await c.query(
        `SELECT * FROM project_phases WHERE project_id=$1 ORDER BY position, starts_on NULLS LAST, id`, [id])).rows;
      return { project, phases };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(out);
  }));

  // ---- the Gantt (the client's "calendar") --------------------------------
  // Rows are processes grouped by stage; columns are working days. The grid is
  // computed here so the agency view and the client portal cannot drift into
  // drawing two different calendars from the same dates.
  r.get('/projects/:id/gantt', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const settings = await readSettings(req.sql, ['working_days']);
    const workingDays = (settings.working_days || 'mon,tue,wed,thu,fri').split(',').map(x => x.trim());

    const out = await req.q(async c => {
      const q = (t, p) => c.query(t, p).then(x => x.rows);
      const [project] = await q(
        `SELECT p.id, p.name, p.stage, p.starts_on, p.due_date, p.client_due_date,
                p.revisions_included, co.name AS company_name
           FROM projects p JOIN companies co ON co.id=p.company_id WHERE p.id=$1`, [id]);
      if (!project) return null;
      const phases = await q(
        `SELECT id, name, starts_on, ends_on, position FROM project_phases
          WHERE project_id=$1 ORDER BY position, id`, [id]);
      const tasks = await q(
        `SELECT t.id, t.title, t.status, t.visibility, t.starts_on, t.due_date,
                t.client_starts_on, t.client_due_date, t.phase_id, t.is_meeting,
                t.assignee_id, t.difficulty, t.revision_round, t.position, t.missed,
                t.is_deliverable
           FROM tasks t WHERE t.project_id=$1
          ORDER BY t.position, t.id`, [id]);
      return { project, phases, tasks };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });

    const names = await getNameMap(req.user.tenant_id);
    const rows = out.tasks.map(t => ({
      id: t.id, title: t.title, phase_id: t.phase_id,
      status: t.status, is_meeting: t.is_meeting, missed: t.missed,
      visibility: t.visibility, revision_round: t.revision_round,
      assignee: names.get(t.assignee_id) || null,
      span: spanOf(t.starts_on, t.due_date),
      // Shown alongside, so an account manager can see at a glance where the
      // padding sits between the real date and the one the client was given.
      client_span: spanOf(t.client_starts_on, t.client_due_date),
    }));

    // The window covers everything with a date, padded to whole weeks.
    const dates = [];
    for (const r2 of rows) if (r2.span) dates.push(r2.span.from, r2.span.to);
    for (const ph of out.phases) { if (ph.starts_on) dates.push(ph.starts_on); if (ph.ends_on) dates.push(ph.ends_on); }
    for (const d of [out.project.starts_on, out.project.due_date, out.project.client_due_date]) if (d) dates.push(d);
    const today = new Date().toISOString().slice(0, 10);
    dates.push(today);
    const iso = dates.map(d => String(d).slice(0, 10)).sort();
    const pad = (d, days) => {
      const x = new Date(d + 'T00:00:00Z');
      x.setUTCDate(x.getUTCDate() + days);
      return x.toISOString().slice(0, 10);
    };
    const from = pad(iso[0], -3), to = pad(iso[iso.length - 1], 3);

    res.json({
      project: out.project,
      phases: out.phases,
      rows,
      columns: buildColumns(from, to, workingDays),
      today,
      working_days: workingDays,
    });
  }));

  r.post('/projects/:id/phases', only('owner'), wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Phase name is required' });
    const rows = await req.sql(
      `INSERT INTO project_phases(project_id,name,starts_on,ends_on,position)
       VALUES($1,$2,$3,$4,COALESCE((SELECT MAX(position)+1 FROM project_phases WHERE project_id=$1),0))
       RETURNING *`,
      [Number(req.params.id), b.name, b.starts_on || null, b.ends_on || null]);
    res.json(rows[0]);
  }));

  r.patch('/phases/:id', only('owner'), wrap(async (req, res) => {
    const sets = [], vals = [];
    // Same fix as the team PATCH: `|| null` would turn a legitimate
    // `position: 0` (the first phase) into null. Only an empty string —
    // what a blanked date input sends — should become null.
    for (const k of ['name', 'starts_on', 'ends_on', 'position'])
      if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k] === '' ? null : req.body[k]); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(Number(req.params.id));
    const rows = await req.sql(`UPDATE project_phases SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  r.delete('/phases/:id', only('owner'), wrap(async (req, res) => {
    await req.sql('DELETE FROM project_phases WHERE id=$1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  return r;
};
module.exports.buildColumns = buildColumns;
module.exports.spanOf = spanOf;
