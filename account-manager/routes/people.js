// Clients (§7) and the team (§8).
//
// Users live in the control database, so anything joining a person to project
// data does that join in JS — Postgres cannot do it across two databases.
const express = require('express');

const WORK_MODES = ['office', 'remote', 'hybrid'];
// Telegram user ids are numeric and currently 9-10 digits, but Telegram has
// grown that number before — allow headroom rather than hardcode a width
// that breaks the day they do it again.
const TELEGRAM_ID_RE = /^\d{5,15}$/;
// Stable per-person avatar colours, so the same initials are the same colour
// on every card, row and avatar stack in the product.
const AVATAR_COLORS = ['#b45309', '#1d4ed8', '#15803d', '#7c3aed', '#be123c', '#0f766e', '#a16207', '#4338ca'];
const pickColor = id => AVATAR_COLORS[id % AVATAR_COLORS.length];

module.exports = ({ auth, only, wrap, controlPool, hashPin, normalisePhone, getTeam }) => {
  const r = express.Router();
  r.use(auth, only('owner', 'accountant', 'teammate', 'editor'));

  // ---- client companies ---------------------------------------------------
  r.get('/companies', wrap(async (req, res) => {
    const rows = await req.sql(`
      SELECT co.*,
             (SELECT count(*) FROM projects p WHERE p.company_id=co.id AND NOT p.archived)::int AS active_projects,
             (SELECT count(*) FROM projects p WHERE p.company_id=co.id)::int AS total_projects,
             (SELECT row_to_json(x) FROM (
                SELECT name, position, email, phone FROM client_contacts cc
                 WHERE cc.company_id=co.id ORDER BY is_main DESC, id LIMIT 1) x) AS main_contact,
             (SELECT count(*) FROM client_contacts cc WHERE cc.company_id=co.id)::int AS contact_count
        FROM companies co ORDER BY co.status, co.name`);
    res.json(rows);
  }));

  r.get('/companies/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = await req.q(async c => {
      const [company] = (await c.query('SELECT * FROM companies WHERE id=$1', [id])).rows;
      if (!company) return null;
      const contacts = (await c.query(
        'SELECT * FROM client_contacts WHERE company_id=$1 ORDER BY is_main DESC, id', [id])).rows;
      const projects = (await c.query(`
        SELECT p.id, p.name, p.stage, p.due_date, p.archived, pr.pct
          FROM projects p CROSS JOIN LATERAL project_progress(p.id) pr
         WHERE p.company_id=$1 ORDER BY p.archived, p.due_date NULLS LAST`, [id])).rows;
      const documents = (await c.query(
        `SELECT id, name, kind, external_url, size_bytes, created_at FROM files
          WHERE company_id=$1 ORDER BY created_at DESC`, [id])).rows;
      return { company, contacts, projects, documents };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    // The people at the client who have a login of their own.
    const { rows: logins } = await controlPool.query(
      `SELECT id, name, phone, active, telegram_chat_id IS NOT NULL AS telegram
         FROM users WHERE tenant_id=$1 AND role='client' AND company_id=$2`,
      [req.user.tenant_id, id]);
    out.logins = logins;
    res.json(out);
  }));

  r.post('/companies', only('owner', 'accountant'), wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Name is required' });
    const out = await req.q(async c => {
      const co = (await c.query(
        `INSERT INTO companies(name,industry,since_date,contact_name,contact_phone,
                               telegram_username,internal_notes,status)
         VALUES($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7,'active') RETURNING *`,
        [b.name, b.industry || '', b.since_date || null, b.contact_name || '', b.contact_phone || '',
         (b.telegram_username || '').replace('@', ''), b.internal_notes || ''])).rows[0];
      // A main contact given at creation becomes the first contact row, so the
      // contacts table is never empty for a client that clearly has one.
      if (b.contact_name)
        await c.query(
          `INSERT INTO client_contacts(company_id,name,position,email,phone,is_main)
           VALUES($1,$2,$3,$4,$5,true)`,
          [co.id, b.contact_name, b.contact_position || '', b.contact_email || '', b.contact_phone || '']);
      return co;
    });
    res.json(out);
  }));

  r.patch('/companies/:id', only('owner', 'accountant'), wrap(async (req, res) => {
    const allowed = ['name', 'industry', 'since_date', 'contact_name', 'contact_phone',
                     'telegram_username', 'internal_notes', 'status'];
    const sets = [], vals = [];
    for (const k of allowed) if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k]); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(Number(req.params.id));
    const rows = await req.sql(`UPDATE companies SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  // ---- contacts at the client ---------------------------------------------
  r.post('/companies/:id/contacts', only('owner', 'accountant'), wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Contact name is required' });
    const out = await req.q(async c => {
      if (b.is_main) await c.query('UPDATE client_contacts SET is_main=false WHERE company_id=$1',
        [Number(req.params.id)]);
      return (await c.query(
        `INSERT INTO client_contacts(company_id,name,position,email,phone,is_main)
         VALUES($1,$2,$3,$4,$5,COALESCE($6,false)) RETURNING *`,
        [Number(req.params.id), b.name, b.position || '', b.email || '', b.phone || '', b.is_main])).rows[0];
    });
    res.json(out);
  }));

  r.patch('/contacts/:id', only('owner', 'accountant'), wrap(async (req, res) => {
    const sets = [], vals = [];
    for (const k of ['name', 'position', 'email', 'phone', 'is_main'])
      if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k]); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(Number(req.params.id));
    const rows = await req.sql(`UPDATE client_contacts SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  r.delete('/contacts/:id', only('owner', 'accountant'), wrap(async (req, res) => {
    await req.sql('DELETE FROM client_contacts WHERE id=$1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // ---- the team -----------------------------------------------------------
  r.get('/team', wrap(async (req, res) => {
    const team = await getTeam(req.user.tenant_id);
    const staff = team.filter(u => u.role !== 'client')
      .map(u => ({ ...u, avatar_color: u.avatar_color || pickColor(u.id) }));
    if (req.user.role === 'owner') return res.json(staff);
    // Everyone needs names and crafts to assign and mention. Nobody else needs
    // their colleagues' phone numbers, home arrangements or birthdays.
    res.json(staff.map(({ phone, email, birthdate, work_mode, ...u }) => u));
  }));

  r.post('/team', only('owner'), wrap(async (req, res) => {
    const b = req.body || {};
    if (!['accountant', 'editor', 'teammate', 'client'].includes(b.role))
      return res.status(400).json({ error: 'Role must be accountant, editor, teammate or client' });
    if (!b.name || !b.phone || !b.pin) return res.status(400).json({ error: 'Name, phone and a PIN are required' });
    if (!/^\d{4,6}$/.test(String(b.pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });
    if (b.work_mode && !WORK_MODES.includes(b.work_mode))
      return res.status(400).json({ error: 'Work mode must be office, remote or hybrid' });

    let companyId = null;
    if (b.role === 'client') {
      if (!b.company_id) return res.status(400).json({ error: 'A client login must belong to a client company' });
      // Cross-database foreign keys do not exist, so prove the company is real
      // and in *this* agency's database before minting a login for it.
      const found = await req.sql('SELECT id FROM companies WHERE id=$1', [Number(b.company_id)]);
      if (!found.length) return res.status(400).json({ error: 'No such client company' });
      companyId = found[0].id;
    }
    // The whole point of this endpoint: the owner enters a person's Telegram
    // ID directly, rather than that person self-binding through a link.
    // Optional — a login works without it, just without Telegram until later.
    let telegramChatId = null;
    if (b.telegram_id !== undefined && b.telegram_id !== null && String(b.telegram_id).trim() !== '') {
      const tid = String(b.telegram_id).trim();
      if (!TELEGRAM_ID_RE.test(tid))
        return res.status(400).json({ error: 'Telegram ID must be numbers only — find it via @userinfobot' });
      telegramChatId = tid;
    }
    try {
      const { rows } = await controlPool.query(
        `INSERT INTO users(tenant_id,name,phone,pin_hash,role,company_id,craft,title,
                           responsibility,email,work_mode,birthdate,telegram_chat_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'office'),$12,$13)
         RETURNING id,name,phone,role,company_id,craft,title,work_mode,
                   (telegram_chat_id IS NOT NULL) AS telegram_linked`,
        [req.user.tenant_id, b.name, normalisePhone(b.phone), hashPin(b.pin), b.role, companyId,
         b.craft || '', b.title || '', b.responsibility || '', b.email || '',
         b.work_mode, b.birthdate || null, telegramChatId]);
      await controlPool.query('UPDATE users SET avatar_color=$1 WHERE id=$2',
        [pickColor(rows[0].id), rows[0].id]);
      res.json(rows[0]);
    } catch (e) {
      // Two different unique columns can collide here; tell the owner which
      // one, rather than a generic "already exists" that sends them hunting.
      if (e.code === '23505' && e.constraint?.includes('telegram'))
        return res.status(409).json({ error: 'That Telegram ID is already linked to someone else' });
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
    for (const k of ['name', 'craft', 'active', 'title', 'responsibility', 'email',
                     'work_mode', 'birthdate', 'avatar_color'])
      if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k] || null); }
    if ('role' in req.body) {
      if (!['accountant', 'editor', 'teammate'].includes(req.body.role))
        return res.status(400).json({ error: 'Cannot change to that role here' });
      sets.push(`role=$${sets.length + 1}`); vals.push(req.body.role);
    }
    if (req.body.pin) {
      if (!/^\d{4,6}$/.test(String(req.body.pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });
      sets.push(`pin_hash=$${sets.length + 1}`); vals.push(hashPin(req.body.pin));
    }
    // A blank value clears it (unlinking Telegram); anything else must be a
    // bare number — the owner correcting or adding an ID after the fact.
    if ('telegram_id' in req.body) {
      const raw = req.body.telegram_id;
      if (raw === '' || raw === null || raw === undefined) {
        sets.push(`telegram_chat_id=$${sets.length + 1}`); vals.push(null);
      } else {
        const tid = String(raw).trim();
        if (!TELEGRAM_ID_RE.test(tid))
          return res.status(400).json({ error: 'Telegram ID must be numbers only — find it via @userinfobot' });
        sets.push(`telegram_chat_id=$${sets.length + 1}`); vals.push(tid);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(id, req.user.tenant_id);
    try {
      const { rows } = await controlPool.query(
        `UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND tenant_id=$${vals.length}
         RETURNING id,name,phone,role,craft,title,responsibility,email,work_mode,birthdate,active,
                   (telegram_chat_id IS NOT NULL) AS telegram_linked`, vals);
      res.json(rows[0]);
    } catch (e) {
      if (e.code === '23505' && e.constraint?.includes('telegram'))
        return res.status(409).json({ error: 'That Telegram ID is already linked to someone else' });
      throw e;
    }
  }));


  return r;
};
module.exports.WORK_MODES = WORK_MODES;
module.exports.pickColor = pickColor;
