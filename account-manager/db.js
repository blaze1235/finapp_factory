// Ties the control plane to the per-agency databases.
// "One house (a Postgres server), separate rooms (a database per agency)."
const { pool: controlPool, hashPin, verifyPin, initControlDb, listTenants, createTenantDatabase } = require('./lib/control-db');
const { getTenantPool } = require('./lib/tenant-pool');
const { migrateTenantDb, provisionTenantDatabase } = require('./lib/tenant-schema');

async function migrateAllTenants() {
  const tenants = await listTenants();
  for (const t of tenants) await migrateTenantDb(getTenantPool(t.db_name));
  return tenants.length;
}

// Onboards a real agency: their own database, the schema, and the one owner
// account. The owner is created here and nowhere else — there is no invite
// path to it, by design.
async function provisionTenant({ name, code, ownerName, ownerPhone, ownerPin }) {
  const dbName = `am_${code.toLowerCase()}`;
  const tenant = (await controlPool.query(
    `INSERT INTO tenants(name, code, db_name, status, paid_until) VALUES($1,$2,$3,'active',$4) RETURNING *`,
    [name, code, dbName, new Date(Date.now() + 14 * 86400000)])).rows[0];
  await provisionTenantDatabase(dbName);
  const owner = (await controlPool.query(
    `INSERT INTO users(tenant_id, name, phone, pin_hash, role) VALUES($1,$2,$3,$4,'owner') RETURNING id`,
    [tenant.id, ownerName, ownerPhone, hashPin(ownerPin)])).rows[0];
  return { tenant, ownerId: owner.id };
}

async function init() {
  await initControlDb();
  await migrateAllTenants();
}

module.exports = {
  controlPool, hashPin, verifyPin, listTenants, createTenantDatabase,
  getTenantPool, migrateAllTenants, provisionTenant, init,
};
