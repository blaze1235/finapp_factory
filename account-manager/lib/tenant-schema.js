// Applies schema.sql to a tenant database. The schema is a plain .sql file
// rather than a string in JS so it can be read, reviewed and diffed as the
// access-control document it actually is.
const fs = require('fs');
const path = require('path');
const { createTenantDatabase } = require('./control-db');
const { getTenantPool } = require('./tenant-pool');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// Idempotent: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE,
// so this runs against every tenant on every deploy.
async function migrateTenantDb(pool) {
  await pool.query(SCHEMA);
}

async function provisionTenantDatabase(dbName) {
  await createTenantDatabase(dbName);
  const pool = getTenantPool(dbName);
  await migrateTenantDb(pool);
  return pool;
}

module.exports = { SCHEMA, migrateTenantDb, provisionTenantDatabase };
