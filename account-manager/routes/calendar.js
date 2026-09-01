// Calendar / Timeline (§6).
//
// Two levels. Across all projects, one bar per project with a delivery marker.
// Inside a project, the bars are its phases — which the owner edits, because a
// phase breakdown that nobody can change is a phase breakdown that goes stale
// in a fortnight.
const express = require('express');

module.exports = ({ auth, only, wrap, getNameMap }) => {
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
    for (const k of ['name', 'starts_on', 'ends_on', 'position'])
      if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k] || null); }
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
