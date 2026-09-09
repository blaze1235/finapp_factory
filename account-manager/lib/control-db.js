// Control plane: the one shared database. It answers "who is this, which
// agency do they belong to, and which database is theirs" — and nothing else.
// Every project, task and decision lives in that agency's own database.
const { Pool } = require('pg');
const crypto = require('crypto');
const { baseConfig, controlDbName } = require('./conn');

const pool = new Pool({ ...baseConfig(), database: controlDbName() });

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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  db_name TEXT UNIQUE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UZS',
  locale TEXT NOT NULL DEFAULT 'uz',
  status TEXT NOT NULL DEFAULT 'active',
  paid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '',
  surface TEXT NOT NULL DEFAULT 'desktop',
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES roles(key),
  -- Clients only: the companies.id inside the tenant database this person may
  -- see. Postgres cannot enforce this across databases, so it is validated at
  -- invite time and carried into every RLS session as app.company_id.
  company_id INTEGER,
  craft TEXT DEFAULT '',
  -- Team profile (§8). These live here rather than in a tenant database
  -- because they belong to the login, and the team page is read before any
  -- tenant database is opened.
  title TEXT DEFAULT '',
  responsibility TEXT DEFAULT '',
  email TEXT DEFAULT '',
  work_mode TEXT NOT NULL DEFAULT 'office',   -- office | remote | hybrid
  birthdate DATE,
  -- A fixed colour per person, so the same initials are the same colour on
  -- every card, row and avatar stack in the product.
  avatar_color TEXT DEFAULT '',
  -- Set directly by the owner at creation (or added later), not through any
  -- self-bind flow. For a private chat, Telegram's chat_id IS the person's
  -- numeric user id, so an owner who already knows that number is granting
  -- working notifications immediately — no code, no link. The one thing this
  -- cannot do is make Telegram deliver to someone who has never opened the
  -- bot: a bot can only message a chat_id that has messaged it first, which
  -- Telegram enforces platform-side and this app cannot route around. If the
  -- person has not pressed /start yet, notifications queue up as failures
  -- (logged, not thrown) until they do — see lib/telegram.js.
  telegram_chat_id BIGINT UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role <> 'client' OR company_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS responsibility TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS work_mode TEXT NOT NULL DEFAULT 'office';
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthdate DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color TEXT DEFAULT '';

-- A Telegram chat has to resolve to a tenant before we know which database to
-- open, so this mapping cannot live in a tenant database.
CREATE TABLE IF NOT EXISTS telegram_links (
  chat_id BIGINT PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  username TEXT DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'user',   -- user | reports_group
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-use codes so a person can bind their Telegram account without
-- typing a PIN into a chat window.
-- What the bot is waiting for from a given chat. Telegram has no notion of a
-- form, so a two-step exchange ("why?", then the reason) needs the middle
-- state parked somewhere between two independent webhook calls.
CREATE TABLE IF NOT EXISTS pending_actions (
  chat_id BIGINT PRIMARY KEY,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- REVISION: self-serve join links (where the invitee picked their own PIN)
-- are gone. Access is granted the other way now — the owner is the only
-- account that can ever sign in on its own, and every other login is created
-- BY the owner, by hand, with that person's name, phone and Telegram ID
-- already known. There is no public entry point into a fresh agency.
--
-- The 'invites' table this replaced is dropped outright rather than left
-- unused: no real agency had onboarded a client through it yet, so there is
-- nothing to migrate, and a dead table with a live-looking API is worse than
-- no table.
DROP TABLE IF EXISTS invites CASCADE;

CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
`;

// Four roles, deliberately. A per-resource view/edit/approve/manage matrix was
// considered and dropped: at 6–8 people every cell resolves the same way, and
// an unused matrix is just a way to get a cell wrong. Revisit only when a real
// combination cannot be expressed here.
// Five permission levels (§8). Editor and Member share a data scope — the
// difference is that an editor may assign work to other people, which the
// task field guard in schema.sql enforces.
const ROLES = [
  ['owner',      'Account manager', '*',                                            'desktop', 10],
  ['accountant', 'Accountant',      'finance,clients,projects',                     'desktop', 20],
  ['editor',     'Editor',          'projects,tasks,files,my_week,calendar,assign', 'desktop', 30],
  ['teammate',   'Member',          'projects,tasks,files,my_week,calendar',        'desktop', 40],
  ['client',     'Client',          'portal',                                       'portal',  50],
];

async function initControlDb() {
  await pool.query(SCHEMA);
  for (const [key, name, permissions, surface, sort_order] of ROLES) {
    await pool.query(
      `INSERT INTO roles(key, name, permissions, surface, sort_order) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (key) DO UPDATE SET name=$2, permissions=$3, surface=$4, sort_order=$5`,
      [key, name, permissions, surface, sort_order]);
  }
}

async function listTenants() {
  return (await pool.query('SELECT * FROM tenants ORDER BY id')).rows;
}

// CREATE DATABASE cannot run inside a transaction, hence the raw client.
async function createTenantDatabase(dbName) {
  const client = await pool.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
    if (!exists.rows.length) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    client.release();
  }
}

module.exports = { pool, hashPin, verifyPin, initControlDb, listTenants, createTenantDatabase, SCHEMA };
