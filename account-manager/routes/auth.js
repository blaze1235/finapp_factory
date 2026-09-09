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

  // REVISION: there used to be a public, unauthenticated join-link flow here
  // (a person picked their own PIN). It is gone. The owner is the only
  // account that signs itself in; every other login — including a client's —
  // is created directly by the owner via POST /api/team, PIN and Telegram ID
  // included. There is deliberately no unauthenticated route in this file
  // that can create a user.

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
