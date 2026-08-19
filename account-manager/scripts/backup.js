// Daily backup of every tenant database — "we can't let ANY data be deleted."
// Pure Node/pg table dump (no dependency on the pg_dump binary being present in
// the deploy image — Railway's default Node build doesn't ship it, and failing
// silently on a missing binary is exactly the failure mode we can't afford).
// Writes to the persistent volume mounted at BACKUP_DIR so it survives redeploys.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pool: controlPool, listTenants } = require('../lib/control-db');
const { getTenantPool } = require('../lib/tenant-pool');

const BACKUP_DIR = process.env.BACKUP_DIR || '/data/backups';
const KEEP_DAILY = 31;
const KEEP_MONTHLY = 12;

async function dumpDatabase(pool) {
  const { rows: tables } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const dump = {};
  for (const { tablename } of tables) {
    const { rows } = await pool.query(`SELECT * FROM "${tablename}"`);
    dump[tablename] = rows;
  }
  return dump;
}

function writeCompressed(filePath, obj) {
  const json = JSON.stringify(obj);
  fs.writeFileSync(filePath, zlib.gzipSync(json));
}

function pruneOldBackups(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort();
  const keep = new Set(files.slice(-KEEP_DAILY));
  const byMonth = new Map();
  for (const f of files) {
    const month = f.slice(0, 7); // filenames start YYYY-MM-DD
    if (!byMonth.has(month)) byMonth.set(month, f);
  }
  for (const m of [...byMonth.keys()].sort().slice(-KEEP_MONTHLY)) keep.add(byMonth.get(m));
  for (const f of files) if (!keep.has(f)) fs.unlinkSync(path.join(dir, f));
}

async function maybeUploadOffsite(filePath, tenantCode) {
  if (!process.env.S3_BUCKET) return; // no off-host storage configured yet — see README
  try {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    });
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: `${tenantCode}/${path.basename(filePath)}`, Body: fs.readFileSync(filePath) }));
  } catch (e) {
    console.error(`off-host upload failed for ${tenantCode}:`, e.message);
  }
}

async function runBackups() {
  const tenants = await listTenants();
  const date = new Date().toISOString().slice(0, 10);

  const controlDir = path.join(BACKUP_DIR, '_control');
  fs.mkdirSync(controlDir, { recursive: true });
  writeCompressed(path.join(controlDir, `${date}.json.gz`), await dumpDatabase(controlPool));
  pruneOldBackups(controlDir);

  for (const t of tenants) {
    const dir = path.join(BACKUP_DIR, t.code);
    fs.mkdirSync(dir, { recursive: true });
    const outFile = path.join(dir, `${date}.json.gz`);
    try {
      writeCompressed(outFile, await dumpDatabase(getTenantPool(t.db_name)));
      pruneOldBackups(dir);
      await maybeUploadOffsite(outFile, t.code);
    } catch (e) {
      console.error(`backup failed for tenant ${t.code}:`, e.message);
    }
  }
  console.log(`Backups complete for ${tenants.length} tenant(s) + control DB — ${date}`);
}

if (require.main === module) {
  runBackups().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runBackups, dumpDatabase };
