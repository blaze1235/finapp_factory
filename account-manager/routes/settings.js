// Settings (§12) — owner only.
//
// Everything here is a row in the `settings` key/value table, so a new toggle
// is a new key rather than a migration. Defaults are declared here in one
// place, which means an unset key behaves predictably instead of undefined.
const express = require('express');

const DEFAULTS = {
  // Workspace
  agency_name: '',                       // shown to clients; blank falls back to the tenant name
  timezone: 'Asia/Tashkent',
  language: 'uz',
  week_start: 'monday',
  working_days: 'mon,tue,wed,thu,fri',

  // Client visibility defaults — these are the safe answers, so a new task is
  // private until somebody decides otherwise.
  new_tasks_internal: 'true',
  hide_history_before_visible: 'true',
  show_client_deadline_only: 'true',
  clients_can_reply: 'false',            // reply to a thread, never start one

  // Telegram
  tg_daily_summary: 'true',
  tg_deadline_reminder: 'true',
  tg_overdue_alerts: 'true',

  // Points (§5). Retunable without a deploy — schema.sql reads these.
  points_easy: '5',
  points_medium: '10',
  points_hard: '20',
  points_early_bonus: '2',
  points_late_penalty: '3',
  points_missed_penalty: '5',
  badge_jolbors_points: '60',
  badge_baku_points: '120',
  badge_cannes_points: '200',
};

// Anything a non-owner surface legitimately needs to render correctly.
const PUBLIC_KEYS = ['agency_name', 'timezone', 'language', 'week_start', 'clients_can_reply'];

async function readSettings(sql, keys) {
  const rows = await sql(`SELECT key, value FROM settings`);
  const stored = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const out = {};
  for (const k of (keys || Object.keys(DEFAULTS))) out[k] = stored[k] ?? DEFAULTS[k] ?? null;
  return out;
}

module.exports = ({ auth, only, wrap }) => {
  const r = express.Router();
  r.use(auth);

  // The handful of settings every surface needs; not owner-gated.
  r.get('/public', wrap(async (req, res) => res.json(await readSettings(req.sql, PUBLIC_KEYS))));

  r.get('/', only('owner'), wrap(async (req, res) => {
    res.json({ settings: await readSettings(req.sql), defaults: DEFAULTS });
  }));

  r.put('/', only('owner'), wrap(async (req, res) => {
    const incoming = Object.entries(req.body || {})
      .filter(([k]) => k in DEFAULTS);
    if (!incoming.length) return res.status(400).json({ error: 'No known settings in that request' });
    await req.q(async c => {
      for (const [k, v] of incoming)
        await c.query(
          `INSERT INTO settings(key,value) VALUES($1,$2)
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [k, String(v)]);
    });
    res.json(await readSettings(req.sql));
  }));

  // "Export everything as an archive." Reads through the owner's own RLS
  // session, so it can only ever contain what the person asking may see.
  r.get('/export', only('owner'), wrap(async (req, res) => {
    const tables = ['companies', 'client_contacts', 'projects', 'project_members', 'project_phases',
                    'tasks', 'task_versions', 'comments', 'files', 'approvals', 'scope_alerts',
                    'accounts', 'transactions', 'points_events', 'activity', 'settings'];
    const dump = await req.q(async c => {
      const out = {};
      for (const t of tables) out[t] = (await c.query(`SELECT * FROM ${t}`)).rows;
      return out;
    });
    res.setHeader('Content-Disposition',
      `attachment; filename="account-manager-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exported_at: new Date().toISOString(), agency: req.tenant.name, data: dump });
  }));

  return r;
};
module.exports.DEFAULTS = DEFAULTS;
module.exports.readSettings = readSettings;
