const express = require('express');
const crypto = require('crypto');

module.exports = ({ controlPool, sign, hashPin, verifyPin, normalisePhone, auth, wrap }) => {
  const r = express.Router();

  r.post('/login', wrap(async (req, res) => {
    const { phone, pin } = req.body;
    if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN are required' });
    const clean = normalisePhone(phone);
    const { rows } = await controlPool.query(
      `SELECT * FROM users WHERE replace(replace(phone,' ',''),'-','') = $1 AND active`, [clean]);
    const user = rows[0];
    if (!user || !verifyPin(pin, user.pin_hash)) return res.status(401).json({ error: 'Wrong phone or PIN' });
    res.json({ token: sign({ uid: user.id, exp: Date.now() + 30 * 86400000 }), role: user.role });
  }));

  // ---- join links (unauthenticated by necessity) ---------------------------
  // The invitee sets their own PIN, so the agency never knows or transmits it.
  r.get('/invite/:token', wrap(async (req, res) => {
    const { rows } = await controlPool.query(
      `SELECT i.role, i.name, i.phone, i.company_id, i.used_at, i.expires_at, t.name AS agency
         FROM invites i JOIN tenants t ON t.id=i.tenant_id WHERE i.token=$1`, [req.params.token]);
    if (!rows.length) return res.status(404).json({ error: 'This link is not valid' });
    const i = rows[0];
    if (i.used_at) return res.status(410).json({ error: 'This link has already been used' });
    if (new Date(i.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired' });
    res.json({ role: i.role, name: i.name, phone: i.phone, agency: i.agency });
  }));

  r.post('/invite/:token/accept', wrap(async (req, res) => {
    const { name, phone, pin } = req.body || {};
    if (!name || !phone || !pin) return res.status(400).json({ error: 'Name, phone and a PIN are required' });
    if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

    const client = await controlPool.connect();
    try {
      await client.query('BEGIN');
      // Claim the invite first, and only if it is still unclaimed: two people
      // opening the same link cannot both end up with an account.
      const { rows } = await client.query(
        `UPDATE invites SET used_at = now()
          WHERE token=$1 AND used_at IS NULL AND expires_at > now() RETURNING *`, [req.params.token]);
      if (!rows.length) { await client.query('ROLLBACK'); return res.status(410).json({ error: 'This link is no longer valid' }); }
      const inv = rows[0];
      const user = (await client.query(
        `INSERT INTO users(tenant_id,name,phone,pin_hash,role,company_id,craft)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, role`,
        [inv.tenant_id, name, normalisePhone(phone), hashPin(pin), inv.role, inv.company_id, inv.craft || ''])).rows[0];
      await client.query('UPDATE invites SET created_user_id=$1 WHERE token=$2', [user.id, req.params.token]);
      await client.query('COMMIT');
      res.json({ token: sign({ uid: user.id, exp: Date.now() + 30 * 86400000 }), role: user.role });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') return res.status(409).json({ error: 'That phone number already has a login' });
      throw e;
    } finally { client.release(); }
  }));

  r.get('/me', auth, wrap(async (req, res) => {
    const u = req.user;
    res.json({
      id: u.id, name: u.name, role: u.role, role_name: u.role_name, craft: u.craft,
      permissions: u.permissions, surface: u.surface, company_id: u.company_id,
      telegram_linked: !!u.telegram_chat_id,
      title: u.title, avatar_color: u.avatar_color,
      agency: req.tenant.name, currency: req.tenant.currency, locale: req.tenant.locale,
    });
  }));

  // A single-use code the person pastes to the bot, so binding Telegram never
  // involves typing a PIN into a chat window.
  r.post('/telegram/link-code', auth, wrap(async (req, res) => {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    await controlPool.query(
      `INSERT INTO link_codes(code, user_id, expires_at) VALUES($1,$2, now() + interval '15 minutes')`,
      [code, req.user.id]);
    res.json({ code, expires_in_minutes: 15, bot: process.env.TELEGRAM_BOT_USERNAME || null });
  }));

  r.post('/telegram/unlink', auth, wrap(async (req, res) => {
    await controlPool.query('UPDATE users SET telegram_chat_id = NULL WHERE id = $1', [req.user.id]);
    await controlPool.query('DELETE FROM telegram_links WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  }));

  return r;
};
