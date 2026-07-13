import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

await sql`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    brief TEXT NOT NULL,
    department TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning',
    result TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    worker_key TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    output TEXT,
    position INT NOT NULL DEFAULT 0
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    worker_key TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'dept',
    department TEXT,
    worker_key TEXT,
    title TEXT NOT NULL,
    busy BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
await sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS worker_key TEXT`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_dm_worker ON chats(worker_key) WHERE scope = 'dm'`;

await sql`
  CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    worker_key TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'UZS',
    category TEXT NOT NULL DEFAULT 'other',
    note TEXT,
    occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    week_start DATE NOT NULL,
    department TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(week_start, department)
  )`;

await sql`CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)`;
await sql`CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id)`;
await sql`CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id)`;
await sql`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(occurred_on DESC)`;

console.log("✅ migrations applied");
await sql.end();
