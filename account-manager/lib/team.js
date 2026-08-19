// Users live in the control database; tenant databases only store a plain
// user_id integer. These helpers do the join in JS since Postgres can't join
// across two separate databases.
const { pool: controlPool } = require('./control-db');

async function getTeam(tenantId) {
  const { rows } = await controlPool.query(
    `SELECT u.id, u.name, u.phone, u.role, u.active, r.name AS role_name, r.surface
     FROM users u JOIN roles r ON r.key = u.role WHERE u.tenant_id=$1 ORDER BY r.sort_order, u.name`,
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
