// Restores a tenant (or the control DB) from a backup produced by backup.js.
// A backup nobody has ever restored from is not actually a backup — this is
// the tested other half of that promise.
//
// Usage: node scripts/restore.js <tenant_code|control> [date]   (date defaults to latest)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pool: controlPool, listTenants } = require('../lib/control-db');
const { getTenantPool } = require('../lib/tenant-pool');

const BACKUP_DIR = process.env.BACKUP_DIR || '/data/backups';

// Insert order matters because of foreign keys — parents before children.
const TENANT_ORDER = [
  'suppliers', 'routes', 'products', 'locations', 'customers',
  'purchases', 'purchase_items', 'sales', 'sale_items',
  'stock_movements', 'payments', 'expenses', 'notifications', 'settings', 'alerts_fired',
];
const CONTROL_ORDER = ['roles', 'tenants', 'users', 'telegram_links', 'referrals'];

function loadDump(dir, date) {
  const file = date
    ? path.join(dir, `${date}.json.gz`)
    : path.join(dir, fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort().slice(-1)[0] || '');
  if (!file || !fs.existsSync(file)) throw new Error(`No backup found in ${dir}${date ? ` for ${date}` : ''}`);
  return { file, data: JSON.parse(zlib.gunzipSync(fs.readFileSync(file))) };
}

async function restoreInto(pool, dump, order) {
  for (const table of order) {
    const rows = dump[table];
    if (!rows || !rows.length) continue;
    const cols = Object.keys(rows[0]);
    await pool.query(`TRUNCATE TABLE "${table}" CASCADE`);
    for (const row of rows) {
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(
        `INSERT INTO "${table}"(${cols.map(c => `"${c}"`).join(',')}) VALUES(${placeholders})`,
        cols.map(c => row[c]));
    }
    // Keep the sequence ahead of the restored max id so new inserts don't collide.
    if (cols.includes('id'))
      await pool.query(`SELECT setval(pg_get_serial_sequence('"${table}"','id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`);
    console.log(`  restored ${rows.length} row(s) into ${table}`);
  }
}

async function main() {
  const [, , target, date] = process.argv;
  if (!target) {
    console.error('Usage: node scripts/restore.js <tenant_code|control> [date]');
    process.exit(1);
  }
  if (target === 'control') {
    const { file, data } = loadDump(path.join(BACKUP_DIR, '_control'), date);
    console.log(`Restoring control DB from ${file}`);
    await restoreInto(controlPool, data, CONTROL_ORDER);
  } else {
    const tenant = (await listTenants()).find(t => t.code === target);
    if (!tenant) throw new Error(`Unknown tenant code: ${target}`);
    const { file, data } = loadDump(path.join(BACKUP_DIR, target), date);
    console.log(`Restoring tenant ${tenant.name} (${tenant.db_name}) from ${file}`);
    await restoreInto(getTenantPool(tenant.db_name), data, TENANT_ORDER);
  }
  console.log('Restore complete.');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
