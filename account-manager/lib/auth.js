// Stateless auth: phone + PIN, an HMAC-signed token (a signed JSON blob is all
// this needs), and one middleware that resolves a token to the person, their
// agency, their tenant database and — crucially — the RLS context every query
// will run under.
const crypto = require('crypto');
const { withRls } = require('./rls');

function makeTokens(secret) {
  const sign = payload => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  };
  const verify = token => {
    if (!token || !token.includes('.')) return null;
    const [body, mac] = token.split('.');
    const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (p.exp < Date.now()) return null;
      return p;
    } catch { return null; }
  };
  return { sign, verify };
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

const normalisePhone = p => String(p || '').replace(/[^\d+]/g, '');

// Resolves a token to req.user and attaches req.q — a scoped query runner.
// There is deliberately no raw `req.db`: a handler cannot accidentally query
// outside the RLS session, because it is never handed a connection that could.
function createAuth({ controlPool, getTenantPool, verify }) {
  return async function auth(req, res, next) {
    // Deliberately header-only. A session token in a query string ends up in
    // server logs, browser history and the Referer header of any outbound
    // redirect. Downloads need their own narrow token instead — see
    // routes/files.js.
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const p = verify(token);
    if (!p) return res.status(401).json({ error: 'Not signed in' });

    const { rows } = await controlPool.query(
      `SELECT u.id, u.tenant_id, u.name, u.phone, u.role, u.company_id, u.craft, u.telegram_chat_id,
              r.permissions, r.surface, r.name AS role_name,
              t.name AS tenant_name, t.currency, t.locale, t.status AS tenant_status,
              t.paid_until, t.db_name
         FROM users u
         JOIN roles r ON r.key = u.role
         JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1 AND u.active`, [p.uid]);
    if (!rows.length) return res.status(401).json({ error: 'Not signed in' });

    const u = rows[0];
    req.user = u;
    req.tenant = { id: u.tenant_id, name: u.tenant_name, status: u.tenant_status, currency: u.currency, locale: u.locale };

    const pool = getTenantPool(u.db_name);
    const ctx = { userId: u.id, role: u.role, companyId: u.company_id };
    req.rlsContext = ctx;
    req.q = fn => withRls(pool, ctx, fn);
    // Convenience for the common single-statement case.
    req.sql = (text, params) => withRls(pool, ctx, c => c.query(text, params).then(r => r.rows));

    if (req.method !== 'GET' && u.tenant_status === 'locked')
      return res.status(402).json({ error: 'Subscription payment is overdue.', locked: true });
    next();
  };
}

const can = (user, perm) => user.permissions === '*' || user.permissions.split(',').includes(perm);
const need = perm => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ error: 'Not allowed for your role' });
// Route-level role gates. Defence in depth only — the database is the real
// boundary, and every one of these is re-proved by the RLS tests.
const only = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' });

module.exports = { makeTokens, hashPin, verifyPin, createAuth, can, need, only, normalisePhone };
