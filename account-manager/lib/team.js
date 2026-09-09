// Users live in the control database; tenant databases only store a plain
// user_id integer. These helpers do the join in JS since Postgres can't join
// across two separate databases.
const { pool: controlPool } = require('./control-db');

async function getTeam(tenantId) {
  // Was missing craft/title/responsibility/email/work_mode/birthdate/
  // avatar_color entirely — every caller that reads those got `undefined`
  // silently, which is how the Team page ended up rendering blank columns.
  // Fixed here rather than patched around: this is the one place a person's
  // row is assembled, and every caller should get the real thing.
  //
  // telegram_linked is a boolean, never the raw chat id — this function feeds
  // both the owner's own view and, via other routes, what a colleague sees,
  // and nobody but the owner needs anyone else's numeric Telegram id.
  const { rows } = await controlPool.query(
    `SELECT u.id, u.name, u.phone, u.role, u.company_id, u.craft, u.title,
            u.responsibility, u.email, u.work_mode, u.birthdate, u.avatar_color,
            (u.telegram_chat_id IS NOT NULL) AS telegram_linked,
            u.active, r.name AS role_name, r.surface
       FROM users u JOIN roles r ON r.key = u.role
      WHERE u.tenant_id=$1 ORDER BY r.sort_order, u.name`,
    [tenantId]);
  return rows;
}

async function getNameMap(tenantId) {
  const team = await getTeam(tenantId);
  return new Map(team.map(u => [u.id, u.name]));
}

// Attaches `<field>_name` to every row using a users.id column, without a SQL join.
function attachNames(rows, idField, nameField, nameMap) {
  for (const r of rows) r[nameField] = r[idField] != null ? (nameMap.get(r[idField]) || null) : null;
  return rows;
}

module.exports = { getTeam, getNameMap, attachNames };
