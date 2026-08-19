const express = require('express');
const path = require('path');
const db = require('./db');
const { controlPool, getTenantPool } = db;
const { makeTokens, createAuth, hashPin, verifyPin, only, need, normalisePhone } = require('./lib/auth');
const { withRls, asSystem } = require('./lib/rls');
const { getTeam, getNameMap } = require('./lib/team');
const { createTelegram, validateInitData } = require('./lib/telegram');
const { FILES_DIR } = require('./routes/files');
const { runAlerts } = require('./lib/alerts');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && SECRET === 'dev-secret-change-me')
  console.warn('⚠️  SESSION_SECRET is unset — every token this process signs is forgeable.');
const { sign, verify } = makeTokens(SECRET);
const auth = createAuth({ controlPool, getTenantPool, verify });

const telegram = createTelegram({ controlPool, getTenantPool, withRls, asSystem, sign, FILES_DIR });

const deps = {
  auth, only, need, wrap, controlPool, getTenantPool, sign, verify, withRls,
  hashPin, verifyPin, normalisePhone,
  getTeam, getNameMap,
  notifyUser: telegram.notifyUser, notifyStaff: telegram.notifyStaff, notifyScope: telegram.notifyScope,
};

// These two sit above the routers on purpose: each router applies `auth` to
// everything under its mount point, so anything reachable without a token has
// to be declared first.
app.get('/api/health', (req, res) => res.json({ ok: true, telegram: telegram.enabled() }));

// Mini App sign-in: Telegram's signature over initData replaces the login form.
app.post('/api/tg/auth', wrap(async (req, res) => {
  const tgUser = validateInitData(req.body.initData);
  if (!tgUser) return res.status(401).json({ error: 'Could not verify this Telegram session' });
  const { rows } = await controlPool.query(
    'SELECT id, role FROM users WHERE telegram_chat_id = $1 AND active', [tgUser.id]);
  if (!rows.length) return res.status(404).json({
    error: 'This Telegram account is not linked yet.', need_link: true });
  res.json({ token: sign({ uid: rows[0].id, exp: Date.now() + 30 * 86400000 }), role: rows[0].role });
}));

// Order matters. The work and people routers are mounted on bare '/api' and
// apply a staff-only gate to everything beneath it, so the surfaces with their
// own audience — the client portal above all — have to be matched first.
app.use('/api/portal',  require('./routes/portal')(deps));
app.use('/api/files',   require('./routes/files')(deps));
app.use('/api/finance', require('./routes/finance')(deps));
app.use('/api/reports', require('./routes/reports')(deps));
app.use('/api', require('./routes/auth')(deps));
app.use('/api', require('./routes/work')(deps));
app.use('/api', require('./routes/people')(deps));

// ---- Telegram ---------------------------------------------------------------
// The webhook path carries a secret so an open URL cannot be used to inject
// updates that look like they came from Telegram.
app.post(`/tg/webhook/${process.env.TELEGRAM_WEBHOOK_SECRET || 'dev'}`, wrap(async (req, res) => {
  res.json({ ok: true });                       // answer first; Telegram retries slow handlers
  telegram.handleUpdate(req.body).catch(e => console.error('telegram update failed:', e.message));
}));

// ---- platform admin (billing, not a tenant login) ---------------------------
function platformAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || '';
  if (!process.env.PLATFORM_ADMIN_KEY || key !== process.env.PLATFORM_ADMIN_KEY)
    return res.status(401).json({ error: 'Invalid admin key' });
  next();
}
app.get('/api/admin/tenants', platformAdmin, wrap(async (req, res) =>
  res.json((await controlPool.query('SELECT id,name,code,status,paid_until FROM tenants ORDER BY id')).rows)));
app.post('/api/admin/tenants/:id/mark-paid', platformAdmin, wrap(async (req, res) => {
  const days = Number(req.body.days) || 30;
  await controlPool.query(
    `UPDATE tenants SET status='active',
            paid_until = GREATEST(COALESCE(paid_until, now()), now()) + ($1 || ' days')::interval
      WHERE id=$2`, [days, req.params.id]);
  res.json({ ok: true });
}));

// ---- surfaces ---------------------------------------------------------------
// Three separate entry points rather than one app that hides things by role:
// the client portal ships none of the internal code at all.
app.use(express.static(path.join(__dirname, 'public')));
app.get('/portal*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal', 'index.html')));
app.get('/tg*',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'tg', 'index.html')));
app.get('*',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
db.init()
  .then(async () => {
    app.listen(PORT, () => console.log(`Account Manager on :${PORT}`));

    if (telegram.enabled() && process.env.PUBLIC_URL) {
      await telegram.setWebhook(
        `${process.env.PUBLIC_URL}/tg/webhook/${process.env.TELEGRAM_WEBHOOK_SECRET || 'dev'}`)
        .catch(e => console.error('setWebhook failed:', e.message));
    }

    // Daily: deadline and stalled-approval alerts, plus backups. The weekly
    // report goes out on Mondays.
    const dailyTick = async () => {
      try {
        for (const t of await db.listTenants())
          await runAlerts(asSystem, getTenantPool(t.db_name)).catch(e => console.error('alerts:', e.message));
        if (new Date().getDay() === 1) await telegram.pushWeeklyReports().catch(() => {});
        await require('./scripts/backup').runBackups().catch(e => console.error('backup:', e.message));
      } catch (e) { console.error('daily tick failed:', e.message); }
    };
    setInterval(dailyTick, 24 * 3600 * 1000);
    setTimeout(dailyTick, 60 * 1000);
  })
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
