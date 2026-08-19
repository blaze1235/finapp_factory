// One pg.Pool per agency database, created lazily and cached. Every agency
// shares the same physical Postgres server (cheap), but each has its own
// database — a query literally cannot reach another agency's rows.
const { Pool } = require('pg');
const { baseConfig } = require('./conn');

const pools = new Map();

function getTenantPool(dbName) {
  if (!pools.has(dbName)) {
    const pool = new Pool({ ...baseConfig(), database: dbName, max: 5 });
    // A Postgres restart, a failover or a dropped database kills idle
    // connections. pg surfaces that on the pool, and an unhandled 'error'
    // event on an EventEmitter takes the whole process down — so this listener
    // is what keeps a database-level hiccup from becoming an outage.
    pool.on('error', err => console.error(`pool error on ${dbName}:`, err.message));
    pools.set(dbName, pool);
  }
  return pools.get(dbName);
}

// Drop a cached pool after its database is removed or renamed; the next
// getTenantPool builds a fresh one. Without this a re-provisioned database is
// handed a pool full of connections to a database that no longer exists.
async function evictTenantPool(dbName) {
  const pool = pools.get(dbName);
  if (!pool) return;
  pools.delete(dbName);
  await pool.end().catch(() => {});
}

async function closeAll() {
  await Promise.all([...pools.values()].map(p => p.end().catch(() => {})));
  pools.clear();
}

module.exports = { getTenantPool, evictTenantPool, closeAll };
