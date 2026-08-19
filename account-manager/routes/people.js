// Clients (the agency's customers) and the team. Users live in the control
// database, so anything joining a user to project data does that join in JS —
// Postgres cannot do it across two databases.
const express = require('express');

module.exports = ({ auth, only, wrap, controlPool, hashPin, normalisePhone, getTeam }) => {
  const r = express.Router();
  r.use(auth, only('owner', 'accountant', 'teammate'));

  // ---- client companies ---------------------------------------------------
  r.get('/companies', wrap(async (req, res) => {
    const rows = await req.sql(`
      SELECT co.*,
             (SELECT count(*) FROM projects p WHERE p.company_id=co.id AND NOT p.archived)::int AS active_projects
        FROM companies co ORDER BY co.name`);
    res.json(rows);
  }));

  r.post('/companies', only('owner', 'accountant'), wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Name is required' });
    const rows = await req.sql(
      `INSERT INTO companies(name,contact_name,contact_phone,telegram_username,internal_notes)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [b.name, b.contact_name || '', b.contact_phone || '', (b.telegram_username || '').replace('@', ''), b.internal_notes || '']);
    res.json(rows[0]);
  }));

  r.patch('/companies/:id', only('owner', 'accountant'), wrap(async (req, res) => {
    const allowed = ['name', 'contact_name', 'contact_phone', 'telegram_username', 'internal_notes', 'status'];
    const sets = [], vals = [];
    for (const k of allowed) if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k]); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(Number(req.params.id));
    const rows = await req.sql(`UPDATE companies SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  // ---- the team -----------------------------------------------------------
  r.get('/team', only('owner', 'teammate'), wrap(async (req, res) => {
    const team = await getTeam(req.user.tenant_id);
    const staff = team.filter(u => u.role !== 'client');
    // A teammate needs names to assign and mention; they do not need everyone's
    // phone number.
    res.json(req.user.role === 'owner' ? staff
      : staff.map(({ phone, ...u }) => u));
  }));

  // Invites. The owner account is created by hand at provisioning and there is
  // deliberately no path to creating another one here.
  r.post('/team', only('owner'), wrap(async (req, res) => {
    const b = req.body || {};
    const role = b.role;
    if (!['accountant', 'teammate', 'client'].includes(role))
      return res.status(400).json({ error: 'Role must be accountant, teammate or client' });
    if (!b.name || !b.phone || !b.pin) return res.status(400).json({ error: 'Name, phone and a PIN are required' });
    if (!/^\d{4,6}$/.test(String(b.pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

    let companyId = null;
    if (role === 'client') {
      if (!b.company_id) return res.status(400).json({ error: 'A client login must belong to a client company' });
      // Cross-database foreign keys do not exist, so prove the company is real
      // and in *this* agency's database before minting a login for it.
      const found = await req.sql('SELECT id FROM companies WHERE id=$1', [Number(b.company_id)]);
      if (!found.length) return res.status(400).json({ error: 'No such client company' });
      companyId = found[0].id;
    }
    try {
      const { rows } = await controlPool.query(
        `INSERT INTO users(tenant_id,name,phone,pin_hash,role,company_id,craft)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,phone,role,company_id,craft`,
        [req.user.tenant_id, b.name, normalisePhone(b.phone), hashPin(b.pin), role, companyId, b.craft || '']);
      res.json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That phone number already has a login' });
      throw e;
    }
  }));

  r.patch('/team/:id', only('owner'), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const target = (await controlPool.query('SELECT * FROM users WHERE id=$1 AND tenant_id=$2',
      [id, req.user.tenant_id])).rows[0];
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.role === 'owner') return res.status(403).json({ error: 'The owner account cannot be edited here' });

    const sets = [], vals = [];
    for (const k of ['name', 'craft', 'active']) if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k]); }
    if (req.body.pin) {
      if (!/^\d{4,6}$/.test(String(req.body.pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });
      sets.push(`pin_hash=$${sets.length + 1}`); vals.push(hashPin(req.body.pin));
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(id, req.user.tenant_id);
    const { rows } = await controlPool.query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND tenant_id=$${vals.length}
       RETURNING id,name,phone,role,craft,active`, vals);
    res.json(rows[0]);
  }));

  return r;
};
