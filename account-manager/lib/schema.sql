-- =============================================================================
-- Account Manager — tenant database schema
--
-- Two things in here are load-bearing and must not be "simplified" later:
--
-- 1. VISIBILITY IS ENFORCED BY THE DATABASE, NOT BY QUERIES.
--    Every table a client could ever touch has ROW LEVEL SECURITY with policies
--    keyed on three session settings the server sets per request:
--      app.user_id     who is asking
--      app.role        owner | accountant | teammate | client
--      app.company_id  the client's own company (clients only)
--    A route that forgets a WHERE clause returns nothing extra. That is the
--    whole point: one forgotten filter is a client relationship destroyed.
--
--    IMPORTANT: Postgres superusers bypass RLS entirely, even with FORCE. On
--    Railway the app's DATABASE_URL *is* a superuser, so lib/rls.js issues
--    `SET LOCAL ROLE am_app` inside every request transaction. am_app is a
--    plain NOLOGIN role, so the policies below actually apply. Never query a
--    domain table on a raw pool connection — always go through withRls().
--
-- 2. THE REVISION CHAIN IS A TRIGGER, NOT APP CODE.
--    Requesting changes increments the counter, opens the revision task and
--    raises a scope alert the moment the agreed rounds are exceeded — in the
--    same transaction as the decision, so it cannot be missed or raced.
-- =============================================================================

-- ---------- the role the app actually queries as -----------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'am_app') THEN
    CREATE ROLE am_app NOLOGIN;
  END IF;
END $$;

-- ---------- session accessors (fail closed) ----------------------------------
-- current_setting(..., true) returns NULL when unset, so an unconfigured
-- connection resolves to role 'none' and every policy below denies it.
CREATE OR REPLACE FUNCTION app_user_id() RETURNS INTEGER
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::integer $$;

CREATE OR REPLACE FUNCTION app_role() RETURNS TEXT
  LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'none') $$;

CREATE OR REPLACE FUNCTION app_company_id() RETURNS INTEGER
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::integer $$;

CREATE OR REPLACE FUNCTION app_is_staff() RETURNS BOOLEAN
  LANGUAGE sql STABLE AS $$ SELECT app_role() IN ('owner', 'accountant', 'teammate', 'editor') $$;

-- ---------- clients (the agency's customers) ---------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  telegram_username TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',        -- active | paused | former
  -- internal_notes is deliberately on the same row as data clients can read.
  -- Column-level exposure is handled by the client-facing view below; clients
  -- never SELECT this table directly through a route that returns *.
  internal_notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- projects ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  -- Pipeline is set by hand, but the UI proposes the next stage when every
  -- task in the current one is done. Automatic stages lie; unattended manual
  -- stages rot. A one-click suggestion is the honest middle. (Open question 2.)
  stage TEXT NOT NULL DEFAULT 'brief',          -- brief | production | review | delivered | archived
  -- Captured at creation from the signed scope. NOT NULL with no default at the
  -- API layer: if this is never filled in the scope warning never fires and the
  -- feature that makes the agency money is decorative. (Open question 3.)
  revisions_included INTEGER NOT NULL DEFAULT 2 CHECK (revisions_included >= 0),
  owner_id INTEGER,                              -- control-DB users.id (account manager)
  starts_on DATE,
  due_date DATE,                                 -- internal
  client_due_date DATE,                          -- padded, what the client is told
  client_visible BOOLEAN NOT NULL DEFAULT true,
  budget_amount BIGINT NOT NULL DEFAULT 0,       -- finance roles only
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (client_due_date IS NULL OR due_date IS NULL OR client_due_date >= due_date)
);
CREATE INDEX IF NOT EXISTS projects_company_idx ON projects(company_id);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,                      -- control-DB users.id
  craft TEXT NOT NULL DEFAULT 'designer',        -- designer | smm | copywriter | motion | video | manager
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(user_id);

-- ---------- tasks ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  -- Six internal states. Clients are shown three buckets (Coming up /
  -- In progress / Done); 'in_review' is internal business and reads as
  -- In progress, while 'awaiting_client' surfaces as an action, not a status.
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','in_review','awaiting_client','approved','completed')),
  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal','client_visible')),
  -- Set the moment a task first becomes client-visible. Comments written
  -- BEFORE this instant stay internal forever, so flipping a task open never
  -- retroactively exposes the arguing that happened while it was closed.
  -- (Open question 4: recommended answer, implemented.)
  client_visible_from TIMESTAMPTZ,
  assignee_id INTEGER,                           -- control-DB users.id
  due_date DATE,                                 -- internal, real
  client_due_date DATE,                          -- padded, what the client is told
  revision_round INTEGER NOT NULL DEFAULT 0,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  is_deliverable BOOLEAN NOT NULL DEFAULT true,  -- counts toward client progress
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (client_due_date IS NULL OR due_date IS NULL OR client_due_date >= due_date)
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);

-- Versions exist so an approval can point at exactly what was approved.
CREATE TABLE IF NOT EXISTS task_versions (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  note TEXT DEFAULT '',
  sent_by INTEGER,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, version_no)
);

-- ---------- conversation that is *decisions*, not chat ------------------------
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  author_id INTEGER,                             -- control-DB users.id
  author_kind TEXT NOT NULL DEFAULT 'staff',     -- staff | client
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal','client_visible')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (task_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS comments_task_idx ON comments(task_id);

CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES task_versions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  storage_path TEXT DEFAULT '',                  -- on-disk path under FILES_DIR
  external_url TEXT DEFAULT '',                  -- Drive/Dropbox link for heavy video
  mime TEXT DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'attachment',       -- attachment | deliverable | voice_brief
  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal','client_visible')),
  uploaded_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_task_idx ON files(task_id);

-- ---------- the approval record (permanent, never updated) -------------------
CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','changes_requested')),
  decided_by INTEGER,                            -- control-DB users.id (the client user)
  decided_by_name TEXT DEFAULT '',               -- denormalised: the record must survive user deletion
  note TEXT DEFAULT '',
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'portal'          -- portal | telegram
);
CREATE INDEX IF NOT EXISTS approvals_task_idx ON approvals(task_id);

-- ---------- scope: the feature that makes the agency money -------------------
CREATE TABLE IF NOT EXISTS scope_alerts (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  approval_id INTEGER REFERENCES approvals(id) ON DELETE SET NULL,
  revision_round INTEGER NOT NULL,
  revisions_included INTEGER NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'pending'
    CHECK (resolution IN ('pending','absorbed','billed')),
  amount BIGINT NOT NULL DEFAULT 0,
  decided_by INTEGER,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scope_alerts_pending_idx ON scope_alerts(resolution) WHERE resolution = 'pending';

-- ---------- finance (its own tables, its own policies, never joined out) -----
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  issued_on DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (number)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_amount BIGINT NOT NULL DEFAULT 0,
  scope_alert_id INTEGER REFERENCES scope_alerts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT NOT NULL DEFAULT 'transfer',
  note TEXT DEFAULT '',
  recorded_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- platform bookkeeping ---------------------------------------------
CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id INTEGER,
  actor_name TEXT DEFAULT '',
  verb TEXT NOT NULL,
  detail TEXT DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal','client_visible')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_project_idx ON activity(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,                               -- NULL = whole role
  role TEXT NOT NULL DEFAULT 'all',
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'info',             -- info | approval | scope | deadline
  -- `body` is an English fallback; `params` is what the UI actually renders,
  -- so a notification raised by a trigger still reads in the user's language.
  params JSONB NOT NULL DEFAULT '{}',
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts_fired (
  key TEXT PRIMARY KEY,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Set-returning helpers, all SECURITY DEFINER.
--
-- Why: a policy on `tasks` that reads `project_members` would itself be
-- filtered by that table's policy, and a policy that reads its own table
-- recurses and errors outright. Running these as the owner sidesteps both.
-- They leak nothing — each one already filters to the caller's own session.
-- =============================================================================
CREATE OR REPLACE FUNCTION app_my_projects() RETURNS SETOF INTEGER
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT project_id FROM project_members WHERE user_id = app_user_id()
$$;

CREATE OR REPLACE FUNCTION app_client_projects() RETURNS SETOF INTEGER
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT id FROM projects
     WHERE app_company_id() IS NOT NULL
       AND company_id = app_company_id() AND client_visible AND NOT archived
$$;

-- Companies a teammate touches, derived only from their own memberships.
CREATE OR REPLACE FUNCTION app_my_companies() RETURNS SETOF INTEGER
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT DISTINCT company_id FROM projects WHERE id IN (SELECT app_my_projects())
$$;

-- =============================================================================
-- Triggers
-- =============================================================================

-- A teammate may move their own work along, but the fields that decide what a
-- client sees and when are not theirs to change. Enforced here rather than in a
-- route so it holds for the API, the Telegram bot and any future surface alike.
CREATE OR REPLACE FUNCTION trg_task_field_guard() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  -- Neither an editor nor a member decides what a client sees or when.
  IF app_role() IN ('teammate','editor') THEN
    IF NEW.visibility          IS DISTINCT FROM OLD.visibility          THEN RAISE EXCEPTION 'Only the account manager can change who sees this task'; END IF;
    IF NEW.client_visible_from IS DISTINCT FROM OLD.client_visible_from THEN RAISE EXCEPTION 'Only the account manager can change client visibility'; END IF;
    IF NEW.client_due_date     IS DISTINCT FROM OLD.client_due_date     THEN RAISE EXCEPTION 'Only the account manager can change the client deadline'; END IF;
    IF NEW.revision_round      IS DISTINCT FROM OLD.revision_round      THEN RAISE EXCEPTION 'Revision rounds are counted automatically'; END IF;
    IF NEW.project_id          IS DISTINCT FROM OLD.project_id          THEN RAISE EXCEPTION 'A task cannot be moved between projects'; END IF;
    IF NEW.missed              IS DISTINCT FROM OLD.missed              THEN RAISE EXCEPTION 'Only the account manager can write a task off as missed'; END IF;
    IF NEW.difficulty          IS DISTINCT FROM OLD.difficulty          THEN RAISE EXCEPTION 'Difficulty is set when the task is created — it decides the points'; END IF;
  END IF;
  -- The one thing that separates the two levels: an editor assigns work.
  IF app_role() = 'teammate' AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    RAISE EXCEPTION 'Only an editor or the account manager can reassign a task';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS task_field_guard ON tasks;
CREATE TRIGGER task_field_guard BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION trg_task_field_guard();

-- Stamp the moment a task first opens to the client, and the moment it closes.
CREATE OR REPLACE FUNCTION trg_task_stamps() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.visibility = 'client_visible' AND NEW.client_visible_from IS NULL THEN
    NEW.client_visible_from := now();
  END IF;
  IF NEW.status IN ('completed','approved') AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status NOT IN ('completed','approved') THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS task_stamps ON tasks;
CREATE TRIGGER task_stamps BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION trg_task_stamps();

-- ---------------------------------------------------------------------------
-- The revision chain. SECURITY DEFINER because a client's own policies forbid
-- writing tasks, scope alerts and notifications — and rightly so. Recording a
-- decision is the one moment their action drives privileged machinery, and it
-- happens in the same transaction as the decision, so the counter can never
-- drift from the record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_approval_chain() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t          tasks%ROWTYPE;
  proj       projects%ROWTYPE;
  next_round INTEGER;
  new_task   INTEGER;
BEGIN
  SELECT * INTO t FROM tasks WHERE id = NEW.task_id;
  SELECT * INTO proj FROM projects WHERE id = t.project_id;

  IF NEW.decision = 'approved' THEN
    UPDATE tasks SET status = 'approved' WHERE id = t.id;
    INSERT INTO activity(project_id, task_id, actor_id, actor_name, verb, detail, visibility)
      VALUES (t.project_id, t.id, NEW.decided_by, NEW.decided_by_name, 'approved',
              format('v%s of "%s"', NEW.version_no, t.title), 'client_visible');
    INSERT INTO notifications(user_id, role, title, body, kind, link, params)
      VALUES (t.assignee_id, 'owner', 'Approved',
              format('%s approved "%s" (v%s).', COALESCE(NULLIF(NEW.decided_by_name,''),'The client'), t.title, NEW.version_no),
              'approval', format('/task/%s', t.id),
              jsonb_build_object('event','approved','who',NEW.decided_by_name,'task',t.title,'version',NEW.version_no));
    RETURN NEW;
  END IF;

  -- changes_requested ------------------------------------------------------
  next_round := t.revision_round + 1;
  UPDATE tasks SET revision_round = next_round, status = 'in_progress' WHERE id = t.id;

  INSERT INTO tasks(project_id, title, description, status, visibility, assignee_id,
                    due_date, client_due_date, parent_task_id, is_deliverable,
                    revision_round, created_by)
    VALUES (t.project_id,
            format('Revision %s — %s', next_round, t.title),
            NEW.note,
            'todo', 'internal', t.assignee_id,
            CURRENT_DATE + 2, CURRENT_DATE + 3,
            t.id, false, next_round, NEW.decided_by)
    RETURNING id INTO new_task;

  INSERT INTO activity(project_id, task_id, actor_id, actor_name, verb, detail, visibility)
    VALUES (t.project_id, t.id, NEW.decided_by, NEW.decided_by_name, 'requested changes',
            format('round %s on v%s', next_round, NEW.version_no), 'client_visible');

  INSERT INTO notifications(user_id, role, title, body, kind, link, params)
    VALUES (t.assignee_id, 'teammate', 'Changes requested',
            format('Round %s on "%s": %s', next_round, t.title, left(COALESCE(NEW.note,''), 180)),
            'approval', format('/task/%s', new_task),
            jsonb_build_object('event','changes_requested','who',NEW.decided_by_name,'task',t.title,
                               'round',next_round,'note',left(COALESCE(NEW.note,''),300)));

  -- Beyond the agreed rounds: warn the owner NOW, with the decision attached,
  -- not three weeks later at invoicing.
  IF next_round > proj.revisions_included THEN
    INSERT INTO scope_alerts(project_id, task_id, approval_id, revision_round, revisions_included)
      VALUES (t.project_id, t.id, NEW.id, next_round, proj.revisions_included);
    INSERT INTO notifications(user_id, role, title, body, kind, link, params)
      VALUES (proj.owner_id, 'owner', 'Beyond agreed revisions',
              format('"%s" is on round %s; the scope allows %s. Absorb it or bill it as extra scope.',
                     t.title, next_round, proj.revisions_included),
              'scope', format('/project/%s', t.project_id),
              jsonb_build_object('event','scope_exceeded','task',t.title,'round',next_round,
                                 'included',proj.revisions_included,'project',proj.name));
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS approval_chain ON approvals;
CREATE TRIGGER approval_chain AFTER INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION trg_approval_chain();

-- Sending for approval opens the next version and puts the ball in the
-- client's court; both halves belong together so neither can be forgotten.
CREATE OR REPLACE FUNCTION trg_version_sent() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE proj_id INTEGER;
BEGIN
  UPDATE tasks SET status = 'awaiting_client',
                   visibility = 'client_visible',
                   client_visible_from = COALESCE(client_visible_from, now())
   WHERE id = NEW.task_id
   RETURNING project_id INTO proj_id;
  INSERT INTO activity(project_id, task_id, actor_id, verb, detail, visibility)
    VALUES (proj_id, NEW.task_id, NEW.sent_by, 'sent for approval',
            format('v%s', NEW.version_no), 'client_visible');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS version_sent ON task_versions;
CREATE TRIGGER version_sent AFTER INSERT ON task_versions
  FOR EACH ROW EXECUTE FUNCTION trg_version_sent();

-- =============================================================================
-- Progress (open question 1)
--
-- "Completed over total" is honest but jumps: a client watching a 4-deliverable
-- project sees 0%, 0%, 0%, then 25% while three of them are actually finished
-- and sitting in review. Weighting by how far along each deliverable is moves
-- the bar every time real work happens, which is what makes it trustworthy.
--
-- The weights live here, once, so the client portal and the internal dashboard
-- cannot drift apart and start quoting different numbers at each other.
--
-- The bar is always shown next to a plain "N of M delivered" count, so the
-- weighting can never be mistaken for a completion claim.
-- =============================================================================
CREATE OR REPLACE FUNCTION task_weight(status TEXT) RETURNS NUMERIC
  LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE status
      WHEN 'todo'            THEN 0.00
      WHEN 'in_progress'     THEN 0.35
      WHEN 'in_review'       THEN 0.60   -- real work done; the client is told "in progress"
      WHEN 'awaiting_client' THEN 0.80   -- everything the agency controls is finished
      WHEN 'approved'        THEN 1.00
      WHEN 'completed'       THEN 1.00
      ELSE 0.00 END
$$;

-- Deliberately reads through RLS: called by a client it sees only their
-- deliverables, called by the owner it sees everything. Pass visible_only to
-- ask the owner-side question "what does the client think progress is?".
CREATE OR REPLACE FUNCTION project_progress(pid INTEGER, visible_only BOOLEAN DEFAULT false)
  RETURNS TABLE (pct INTEGER, done INTEGER, total INTEGER)
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(ROUND(AVG(task_weight(status)) * 100)::integer, 0),
           COUNT(*) FILTER (WHERE status IN ('approved','completed'))::integer,
           COUNT(*)::integer
      FROM tasks
     WHERE project_id = pid
       AND is_deliverable
       AND (NOT visible_only OR visibility = 'client_visible')
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
--
-- Read these as the real access-control document for the product; the routes
-- are a convenience layer on top. Policies are permissive, so the ones that
-- match a given role are OR-ed together.
--
-- One idiom is used throughout: `task_id IN (SELECT id FROM tasks)` is *not* a
-- no-op — that inner SELECT is itself filtered by the tasks policies, so it
-- reads as "a task this person is allowed to see". Visibility composes down
-- the tree without any table needing to restate the rules above it.
-- =============================================================================

-- ---------- companies --------------------------------------------------------
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_office ON companies;
CREATE POLICY companies_office ON companies FOR ALL TO am_app
  USING (app_role() IN ('owner','accountant')) WITH CHECK (app_role() IN ('owner','accountant'));
DROP POLICY IF EXISTS companies_teammate ON companies;
CREATE POLICY companies_teammate ON companies FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor') AND id IN (SELECT app_my_companies()));
DROP POLICY IF EXISTS companies_client ON companies;
CREATE POLICY companies_client ON companies FOR SELECT TO am_app
  USING (app_role() = 'client' AND id = app_company_id());

-- ---------- projects ---------------------------------------------------------
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_owner ON projects;
CREATE POLICY projects_owner ON projects FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS projects_accountant ON projects;
CREATE POLICY projects_accountant ON projects FOR SELECT TO am_app
  USING (app_role() = 'accountant');
DROP POLICY IF EXISTS projects_teammate ON projects;
CREATE POLICY projects_teammate ON projects FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor') AND id IN (SELECT app_my_projects()));
-- Written inline rather than via app_client_projects() so this policy never
-- reads its own table through a helper.
DROP POLICY IF EXISTS projects_client ON projects;
CREATE POLICY projects_client ON projects FOR SELECT TO am_app
  USING (app_role() = 'client' AND company_id = app_company_id()
         AND client_visible AND NOT archived);

-- ---------- project_members --------------------------------------------------
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_owner ON project_members;
CREATE POLICY members_owner ON project_members FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS members_teammate ON project_members;
CREATE POLICY members_teammate ON project_members FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor') AND project_id IN (SELECT app_my_projects()));
-- Assignee names are shown to clients — the client asked for it, and the
-- trade-off is understood. Only the membership list, never contact details.
DROP POLICY IF EXISTS members_client ON project_members;
CREATE POLICY members_client ON project_members FOR SELECT TO am_app
  USING (app_role() = 'client' AND project_id IN (SELECT app_client_projects()));

-- ---------- tasks ------------------------------------------------------------
-- The accountant has no policy here at all. Not a filtered view of tasks: none.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_owner ON tasks;
CREATE POLICY tasks_owner ON tasks FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS tasks_teammate_read ON tasks;
CREATE POLICY tasks_teammate_read ON tasks FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor') AND project_id IN (SELECT app_my_projects()));
DROP POLICY IF EXISTS tasks_teammate_write ON tasks;
CREATE POLICY tasks_teammate_write ON tasks FOR UPDATE TO am_app
  USING (app_role() IN ('teammate','editor') AND project_id IN (SELECT app_my_projects()))
  WITH CHECK (app_role() IN ('teammate','editor') AND project_id IN (SELECT app_my_projects()));
DROP POLICY IF EXISTS tasks_teammate_add ON tasks;
CREATE POLICY tasks_teammate_add ON tasks FOR INSERT TO am_app
  WITH CHECK (app_role() IN ('teammate','editor') AND project_id IN (SELECT app_my_projects())
              AND visibility = 'internal');
DROP POLICY IF EXISTS tasks_client ON tasks;
CREATE POLICY tasks_client ON tasks FOR SELECT TO am_app
  USING (app_role() = 'client' AND visibility = 'client_visible'
         AND project_id IN (SELECT app_client_projects()));

-- ---------- task_versions ----------------------------------------------------
ALTER TABLE task_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS versions_staff ON task_versions;
CREATE POLICY versions_staff ON task_versions FOR ALL TO am_app
  USING (app_role() IN ('owner','teammate') AND task_id IN (SELECT id FROM tasks))
  WITH CHECK (app_role() IN ('owner','teammate') AND task_id IN (SELECT id FROM tasks));
DROP POLICY IF EXISTS versions_client ON task_versions;
CREATE POLICY versions_client ON task_versions FOR SELECT TO am_app
  USING (app_role() = 'client' AND task_id IN (SELECT id FROM tasks));

-- ---------- comments ---------------------------------------------------------
-- Clients get SELECT and nothing else. There is deliberately no client INSERT:
-- a chat box would let feedback arrive outside the approval record and bypass
-- the revision counter, which is the whole point of the product.
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_owner ON comments;
CREATE POLICY comments_owner ON comments FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS comments_teammate ON comments;
CREATE POLICY comments_teammate ON comments FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor')
         AND (task_id IN (SELECT id FROM tasks) OR project_id IN (SELECT app_my_projects())));
DROP POLICY IF EXISTS comments_teammate_add ON comments;
CREATE POLICY comments_teammate_add ON comments FOR INSERT TO am_app
  WITH CHECK (app_role() IN ('teammate','editor') AND author_id = app_user_id()
              AND (task_id IN (SELECT id FROM tasks) OR project_id IN (SELECT app_my_projects())));
-- The cutoff: a comment written while the task was internal stays internal
-- forever, even after the task is opened up. (Open question 4.)
DROP POLICY IF EXISTS comments_client ON comments;
CREATE POLICY comments_client ON comments FOR SELECT TO am_app
  USING (app_role() = 'client' AND visibility = 'client_visible'
         AND EXISTS (SELECT 1 FROM tasks t
                      WHERE t.id = comments.task_id
                        AND comments.created_at >= COALESCE(t.client_visible_from, t.created_at)));

-- ---------- files ------------------------------------------------------------
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS files_owner ON files;
CREATE POLICY files_owner ON files FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS files_teammate ON files;
CREATE POLICY files_teammate ON files FOR ALL TO am_app
  USING (app_role() IN ('teammate','editor')
         AND (task_id IN (SELECT id FROM tasks) OR project_id IN (SELECT app_my_projects())))
  WITH CHECK (app_role() IN ('teammate','editor')
         AND (task_id IN (SELECT id FROM tasks) OR project_id IN (SELECT app_my_projects())));
DROP POLICY IF EXISTS files_client ON files;
CREATE POLICY files_client ON files FOR SELECT TO am_app
  USING (app_role() = 'client' AND visibility = 'client_visible'
         AND task_id IN (SELECT id FROM tasks));

-- ---------- approvals --------------------------------------------------------
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approvals_owner ON approvals;
CREATE POLICY approvals_owner ON approvals FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS approvals_teammate ON approvals;
CREATE POLICY approvals_teammate ON approvals FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor') AND task_id IN (SELECT id FROM tasks));
DROP POLICY IF EXISTS approvals_client_read ON approvals;
CREATE POLICY approvals_client_read ON approvals FOR SELECT TO am_app
  USING (app_role() = 'client' AND task_id IN (SELECT id FROM tasks));
-- A client may record a decision on a task they can see, as themselves, and
-- may never edit or delete one afterwards: no UPDATE or DELETE policy exists.
DROP POLICY IF EXISTS approvals_client_decide ON approvals;
CREATE POLICY approvals_client_decide ON approvals FOR INSERT TO am_app
  WITH CHECK (app_role() = 'client' AND decided_by = app_user_id()
              AND task_id IN (SELECT id FROM tasks));

-- ---------- scope alerts -----------------------------------------------------
ALTER TABLE scope_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scope_owner ON scope_alerts;
CREATE POLICY scope_owner ON scope_alerts FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
-- The accountant sees only what the owner already decided to bill.
DROP POLICY IF EXISTS scope_accountant ON scope_alerts;
CREATE POLICY scope_accountant ON scope_alerts FOR SELECT TO am_app
  USING (app_role() = 'accountant' AND resolution = 'billed');

-- ---------- finance ----------------------------------------------------------
-- Two roles, full stop. No client policy: an unpaid invoice reaching a client
-- portal is exactly the kind of accident this whole design exists to prevent.
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_finance ON invoices;
CREATE POLICY invoices_finance ON invoices FOR ALL TO am_app
  USING (app_role() IN ('owner','accountant')) WITH CHECK (app_role() IN ('owner','accountant'));

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_lines_finance ON invoice_lines;
CREATE POLICY invoice_lines_finance ON invoice_lines FOR ALL TO am_app
  USING (app_role() IN ('owner','accountant')) WITH CHECK (app_role() IN ('owner','accountant'));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_finance ON payments;
CREATE POLICY payments_finance ON payments FOR ALL TO am_app
  USING (app_role() IN ('owner','accountant')) WITH CHECK (app_role() IN ('owner','accountant'));

-- ---------- activity ---------------------------------------------------------
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activity_owner ON activity;
CREATE POLICY activity_owner ON activity FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS activity_teammate ON activity;
CREATE POLICY activity_teammate ON activity FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor') AND project_id IN (SELECT app_my_projects()));
DROP POLICY IF EXISTS activity_teammate_add ON activity;
CREATE POLICY activity_teammate_add ON activity FOR INSERT TO am_app
  WITH CHECK (app_role() IN ('teammate','editor') AND project_id IN (SELECT app_my_projects()));
DROP POLICY IF EXISTS activity_client ON activity;
CREATE POLICY activity_client ON activity FOR SELECT TO am_app
  USING (app_role() = 'client' AND visibility = 'client_visible'
         AND project_id IN (SELECT app_client_projects()));

-- ---------- notifications ----------------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_mine ON notifications;
CREATE POLICY notifications_mine ON notifications FOR ALL TO am_app
  USING (user_id = app_user_id()
         OR (user_id IS NULL AND app_is_staff() AND (role = app_role() OR role = 'all')))
  WITH CHECK (app_role() = 'owner' OR user_id = app_user_id());

-- ---------- settings & alert dedup (staff only) ------------------------------
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_staff ON settings;
CREATE POLICY settings_staff ON settings FOR ALL TO am_app
  USING (app_is_staff()) WITH CHECK (app_role() = 'owner');

ALTER TABLE alerts_fired ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts_fired FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alerts_staff ON alerts_fired;
CREATE POLICY alerts_staff ON alerts_fired FOR ALL TO am_app
  USING (app_is_staff()) WITH CHECK (app_is_staff());


-- =============================================================================
-- Client-safe views
--
-- RLS decides which ROWS a client may read; it says nothing about columns. A
-- client can legitimately see their own task row — and that row still carries
-- `due_date`, the internal deadline, right next to `client_due_date`, the
-- padded one they were told. `SELECT *` in one careless portal query hands
-- them the real date and the padding in the same breath.
--
-- These views are the only thing the portal reads. Columns are listed, so a
-- column added to a table later is private until somebody deliberately adds it
-- here. security_invoker=true is what makes them safe: without it a view runs
-- as its owner (a superuser) and would bypass every policy above.
-- =============================================================================
-- v_client_projects and v_client_tasks are defined in the v2 section below,
-- which is where the client's revised visibility rules live.
CREATE OR REPLACE VIEW v_client_comments WITH (security_invoker = true) AS
  SELECT c.id, c.task_id, c.body, c.author_kind, c.created_at
    FROM comments c;

CREATE OR REPLACE VIEW v_client_files WITH (security_invoker = true) AS
  SELECT f.id, f.task_id, f.name, f.mime, f.size_bytes, f.kind, f.external_url, f.created_at
    FROM files f;

CREATE OR REPLACE VIEW v_client_approvals WITH (security_invoker = true) AS
  SELECT a.id, a.task_id, a.version_no, a.decision, a.decided_by_name, a.note, a.decided_at
    FROM approvals a;

-- The views defined here; the two that moved to the v2 section are granted
-- there, after they exist.
GRANT SELECT ON v_client_comments, v_client_files, v_client_approvals TO am_app;

-- ---------- privileges -------------------------------------------------------
-- am_app can touch every table, and RLS decides which rows. Without the GRANTs
-- the policies would never even be consulted.
GRANT USAGE ON SCHEMA public TO am_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO am_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO am_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO am_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO am_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO am_app;


-- #############################################################################
-- v2 — the client's revised specification
--
-- Everything below is additive and idempotent, so it migrates a live agency
-- database on deploy without a separate migration step.
--
-- Three changes here deliberately REVERSE decisions recorded above, at the
-- client's written request. They are marked REVERSAL so nobody later "fixes"
-- them back:
--   * clients no longer see who is doing the work
--   * per-person performance is now tracked and ranked
--   * six named pipeline stages instead of five
-- #############################################################################

-- ---------- projects: six named stages ---------------------------------------
-- REVERSAL: the earlier five stages become the six the client named.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_stage_check;
UPDATE projects SET stage = 'delivery' WHERE stage IN ('delivered', 'archived');
ALTER TABLE projects ADD CONSTRAINT projects_stage_check
  CHECK (stage IN ('brief','concept','production','review','approval','delivery'));

-- ---------- tasks: difficulty, points, and the file requirement --------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_difficulty_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_difficulty_check
  CHECK (difficulty IN ('easy','medium','hard'));
-- "Requires a file upload?" — when true the task cannot be closed until
-- something is actually attached, so "done" and "delivered" stay the same word.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_file BOOLEAN NOT NULL DEFAULT false;
-- Missed is a decision someone makes, not a date passing: a task is only
-- penalised once the owner says it was abandoned.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS missed BOOLEAN NOT NULL DEFAULT false;

-- ---------- companies: industry, since-date, active/past ---------------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS industry TEXT DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS since_date DATE;
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_status_check;
UPDATE companies SET status = 'past' WHERE status IN ('former','paused');
ALTER TABLE companies ADD CONSTRAINT companies_status_check
  CHECK (status IN ('active','past'));

-- A client is an organisation, not a person: several people there may need to
-- be reachable, and one of them is the main contact.
CREATE TABLE IF NOT EXISTS client_contacts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  is_main BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_contacts_company_idx ON client_contacts(company_id);

-- ---------- timeline phases --------------------------------------------------
-- The single-project timeline is phases, not stages: a project sits in one
-- stage at a time, but its phases overlap and are drawn side by side.
CREATE TABLE IF NOT EXISTS project_phases (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_on DATE,
  ends_on DATE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS project_phases_project_idx ON project_phases(project_id);

-- A task without a start is a one-day bar on its due date; giving it a start
-- turns it into a span. Left nullable so nothing existing has to be backfilled.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS starts_on DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_starts_on DATE;

-- The stage rail down the left of their sheet. Phases already model exactly
-- this, so tasks hang off them rather than gaining a parallel "stage" column
-- that could disagree with the phase dates.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS phase_id INTEGER REFERENCES project_phases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_phase_idx ON tasks(phase_id);

-- Their red cells: "дата встречи для презентации". A presentation is a fixed
-- appointment, not work in progress, so it is its own thing rather than a
-- status — it can be scheduled while the work feeding it is still yellow.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_meeting BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_span_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_span_check
  CHECK (starts_on IS NULL OR due_date IS NULL OR due_date >= starts_on);

-- ---------- documents --------------------------------------------------------
-- Contracts (shartnoma) hang off the client, not a task, so files gains a
-- company scope and a 'document' kind for the client's Documents page.
ALTER TABLE files ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS files_company_idx ON files(company_id);

-- ---------- money: one ledger --------------------------------------------------
-- §9 describes accounts and a transactions ledger and never mentions invoice
-- line items, so invoices/payments collapse into this. An income row with
-- settled = false IS "unpaid to us": it moves profit and leaves cash alone,
-- which is exactly the profit-vs-cash split the spec asks to be shown.
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'UZS',
  opening_balance BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  counterparty TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  -- `period` is the month the money belongs to; `paid_on` is when it moved.
  -- Payroll earned in August and paid on the 30th is an August cost either way,
  -- but only lands in cash once settled — that gap is the whole point.
  period DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  paid_on DATE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  settled BOOLEAN NOT NULL DEFAULT true,
  due_on DATE,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  scope_alert_id INTEGER REFERENCES scope_alerts(id) ON DELETE SET NULL,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_period_idx ON transactions(period);
CREATE INDEX IF NOT EXISTS transactions_company_idx ON transactions(company_id);

-- Status is derived, never stored, so it cannot go stale.
CREATE OR REPLACE FUNCTION transaction_status(settled BOOLEAN, direction TEXT, due_on DATE)
  RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
      WHEN settled AND direction = 'in'  THEN 'received'
      WHEN settled AND direction = 'out' THEN 'paid'
      WHEN due_on IS NOT NULL AND due_on < CURRENT_DATE THEN 'overdue'
      ELSE 'not_settled' END
$$;

-- Retire the invoice model into the ledger. Written as a migration rather than
-- a DROP because a live agency may already have real money in these tables:
-- each invoice becomes one income row, settled if it was paid.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='invoices') THEN
    INSERT INTO transactions(direction, counterparty, description, category, period, paid_on,
                             amount, settled, due_on, company_id, project_id, created_at)
    SELECT 'in',
           co.name,
           COALESCE(NULLIF(i.note,''), 'Invoice ' || i.number),
           'project_fee',
           date_trunc('month', i.issued_on)::date,
           CASE WHEN i.status = 'paid' THEN
             COALESCE((SELECT MAX(p.paid_on) FROM payments p WHERE p.invoice_id = i.id), i.issued_on)
           END,
           GREATEST(COALESCE((SELECT SUM(l.qty * l.unit_amount) FROM invoice_lines l
                               WHERE l.invoice_id = i.id), 0), 1)::bigint,
           i.status = 'paid',
           i.due_on,
           i.company_id, i.project_id, i.created_at
      FROM invoices i JOIN companies co ON co.id = i.company_id
     WHERE i.status <> 'void'
       AND NOT EXISTS (SELECT 1 FROM transactions t
                        WHERE t.description = COALESCE(NULLIF(i.note,''), 'Invoice ' || i.number)
                          AND t.company_id = i.company_id);

    DROP TABLE IF EXISTS invoice_lines CASCADE;
    DROP TABLE IF EXISTS payments CASCADE;
    DROP TABLE IF EXISTS invoices CASCADE;
  END IF;
END $$;

-- ---------- performance ------------------------------------------------------
-- REVERSAL: the first brief deliberately carried no per-person counts. The
-- client has asked for a leaderboard, so the points live here — one row per
-- task, so re-opening and re-closing a task corrects the score rather than
-- awarding it twice.
CREATE TABLE IF NOT EXISTS points_events (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('early','on_time','late','missed')),
  points INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  month DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS points_events_month_idx ON points_events(month, user_id);

-- Defaults live in `settings` so the owner can retune them without a migration.
CREATE OR REPLACE FUNCTION setting_num(k TEXT, fallback NUMERIC)
  RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT value::numeric FROM settings WHERE key = k), fallback)
$$;

CREATE OR REPLACE FUNCTION points_for(difficulty TEXT, kind TEXT)
  RETURNS INTEGER LANGUAGE sql STABLE AS $$
    SELECT CASE kind
      WHEN 'missed' THEN -setting_num('points_missed_penalty', 5)
      WHEN 'late'   THEN -setting_num('points_late_penalty', 3)
      ELSE (CASE difficulty
              WHEN 'easy' THEN setting_num('points_easy', 5)
              WHEN 'hard' THEN setting_num('points_hard', 20)
              ELSE             setting_num('points_medium', 10) END)
           + (CASE WHEN kind = 'early' THEN setting_num('points_early_bonus', 2) ELSE 0 END)
    END::integer
$$;

-- Awarding is a trigger so every surface scores identically and nothing has to
-- remember to call it.
CREATE OR REPLACE FUNCTION trg_award_points() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k TEXT; done_on DATE;
BEGIN
  IF NEW.assignee_id IS NULL THEN
    DELETE FROM points_events WHERE task_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.missed THEN
    k := 'missed';
  ELSIF NEW.status IN ('approved','completed') THEN
    done_on := COALESCE(NEW.completed_at, now())::date;
    k := CASE
           WHEN NEW.due_date IS NULL       THEN 'on_time'
           WHEN done_on <  NEW.due_date    THEN 'early'
           WHEN done_on <= NEW.due_date    THEN 'on_time'
           ELSE 'late' END;
  ELSE
    -- Re-opened: take the score back off the board.
    DELETE FROM points_events WHERE task_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO points_events(task_id, user_id, kind, points, difficulty, month)
    VALUES (NEW.id, NEW.assignee_id, k, points_for(NEW.difficulty, k), NEW.difficulty,
            date_trunc('month', COALESCE(NEW.completed_at, now()))::date)
    ON CONFLICT (task_id) DO UPDATE
      SET user_id = EXCLUDED.user_id, kind = EXCLUDED.kind, points = EXCLUDED.points,
          difficulty = EXCLUDED.difficulty, month = EXCLUDED.month;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS award_points ON tasks;
CREATE TRIGGER award_points AFTER INSERT OR UPDATE OF status, missed, assignee_id, difficulty, due_date
  ON tasks FOR EACH ROW EXECUTE FUNCTION trg_award_points();

-- Badges are named after creative festivals, low to high. Thresholds are
-- settings, so the owner can retune them without a deploy.
CREATE OR REPLACE FUNCTION badge_for(points INTEGER, late_count INTEGER, on_time_pct NUMERIC)
  RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT CASE
      WHEN points >= setting_num('badge_cannes_points', 200) AND on_time_pct >= 90 THEN 'cannes'
      WHEN points >= setting_num('badge_baku_points', 120)                          THEN 'baku'
      WHEN points >= setting_num('badge_jolbors_points', 60) AND late_count = 0     THEN 'jolbors'
      WHEN points >  0                                                              THEN 'taf'
      ELSE 'none' END
$$;

-- ---------- progress over time ------------------------------------------------
-- The weekly report shows where each project stood at the start of the week
-- versus now, which needs the earlier number to have been written down.
CREATE TABLE IF NOT EXISTS progress_snapshots (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  pct INTEGER NOT NULL,
  PRIMARY KEY (project_id, week_start)
);

-- ---------- RLS for the v2 tables --------------------------------------------
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_office ON client_contacts;
CREATE POLICY contacts_office ON client_contacts FOR ALL TO am_app
  USING (app_role() IN ('owner','accountant')) WITH CHECK (app_role() IN ('owner','accountant'));
DROP POLICY IF EXISTS contacts_teammate ON client_contacts;
CREATE POLICY contacts_teammate ON client_contacts FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor') AND company_id IN (SELECT app_my_companies()));
DROP POLICY IF EXISTS contacts_client ON client_contacts;
CREATE POLICY contacts_client ON client_contacts FOR SELECT TO am_app
  USING (app_role() = 'client' AND company_id = app_company_id());

-- Phases drive the client's Timeline page, so clients read them.
ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_phases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phases_owner ON project_phases;
CREATE POLICY phases_owner ON project_phases FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS phases_staff ON project_phases;
CREATE POLICY phases_staff ON project_phases FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor') AND project_id IN (SELECT app_my_projects()));
DROP POLICY IF EXISTS phases_accountant ON project_phases;
CREATE POLICY phases_accountant ON project_phases FOR SELECT TO am_app
  USING (app_role() = 'accountant');
DROP POLICY IF EXISTS phases_client ON project_phases;
CREATE POLICY phases_client ON project_phases FOR SELECT TO am_app
  USING (app_role() = 'client' AND project_id IN (SELECT app_client_projects()));

-- Money: the same two roles as before, and no client policy at all.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounts_finance ON accounts;
CREATE POLICY accounts_finance ON accounts FOR ALL TO am_app
  USING (app_role() IN ('owner','accountant')) WITH CHECK (app_role() IN ('owner','accountant'));

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transactions_finance ON transactions;
CREATE POLICY transactions_finance ON transactions FOR ALL TO am_app
  USING (app_role() IN ('owner','accountant')) WITH CHECK (app_role() IN ('owner','accountant'));

-- The leaderboard is meant to be seen by the team, so teammates read everyone's
-- points. The accountant has no business here and clients never do.
ALTER TABLE points_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS points_owner ON points_events;
CREATE POLICY points_owner ON points_events FOR ALL TO am_app
  USING (app_role() = 'owner') WITH CHECK (app_role() = 'owner');
DROP POLICY IF EXISTS points_teammate ON points_events;
CREATE POLICY points_teammate ON points_events FOR SELECT TO am_app
  USING (app_role() IN ('teammate','editor'));

ALTER TABLE progress_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snapshots_staff ON progress_snapshots;
CREATE POLICY snapshots_staff ON progress_snapshots FOR ALL TO am_app
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- ---------- client-safe views, revised ---------------------------------------
-- REVERSAL: assignee_id is gone. The first brief showed clients who was doing
-- the work because the client had asked for it; the revised spec says team
-- members must not be visible on the client's view of a project. Removing it
-- from the view rather than from the page means no future portal query can
-- reintroduce it by accident.
DROP VIEW IF EXISTS v_client_tasks;
CREATE VIEW v_client_tasks WITH (security_invoker = true) AS
  SELECT t.id, t.project_id, t.title, t.description,
         CASE t.status
           WHEN 'todo'            THEN 'coming_up'
           WHEN 'in_progress'     THEN 'in_progress'
           WHEN 'in_review'       THEN 'in_progress'   -- internal business
           WHEN 'awaiting_client' THEN 'needs_you'
           ELSE 'done'
         END AS bucket,
         (t.status = 'awaiting_client') AS needs_you,
         t.client_due_date AS due,          -- never t.due_date
         t.client_starts_on AS starts,      -- never t.starts_on
         t.phase_id,
         t.is_meeting,
         t.revision_round,
         (SELECT MAX(version_no) FROM task_versions v WHERE v.task_id = t.id) AS version,
         (SELECT count(*) FROM task_versions v WHERE v.task_id = t.id) AS version_count,
         t.created_at
    FROM tasks t;

DROP VIEW IF EXISTS v_client_projects;
CREATE VIEW v_client_projects WITH (security_invoker = true) AS
  SELECT p.id, p.company_id, p.name, p.description, p.stage,
         p.client_due_date AS due,          -- never p.due_date
         p.starts_on,
         pr.pct AS progress_pct, pr.done AS delivered, pr.total AS deliverables
    FROM projects p
    CROSS JOIN LATERAL project_progress(p.id, true) pr;

CREATE OR REPLACE VIEW v_client_phases WITH (security_invoker = true) AS
  SELECT ph.id, ph.project_id, ph.name, ph.starts_on, ph.ends_on, ph.position
    FROM project_phases ph;

-- The three words the client's own sheet uses in its status column. Derived
-- from the internal status, so "in review" never leaks out as its own state.
CREATE OR REPLACE FUNCTION client_state(status TEXT, is_meeting BOOLEAN)
  RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
      WHEN is_meeting                              THEN 'meeting'
      WHEN status IN ('approved','completed')      THEN 'done'
      WHEN status IN ('in_progress','in_review')   THEN 'in_action'
      WHEN status = 'awaiting_client'              THEN 'in_action'
      ELSE 'planned' END
$$;

-- Contracts and anything else deliberately shared with the client.
CREATE OR REPLACE VIEW v_client_documents WITH (security_invoker = true) AS
  SELECT f.id, f.company_id, f.project_id, f.name, f.mime, f.size_bytes,
         f.external_url, f.created_at
    FROM files f
   WHERE f.kind = 'document';

GRANT SELECT ON v_client_projects, v_client_tasks, v_client_comments,
                v_client_files, v_client_approvals, v_client_phases,
                v_client_documents TO am_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO am_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO am_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO am_app;


-- #############################################################################
-- v3 — the timeline the client actually meant
--
-- Their reference is a Gantt: rows are *processes grouped by stage*, columns are
-- working days, and each cell is coloured by state. Three things it needs that
-- the task table did not carry:
--   * a start date, so a task is a span rather than a single due day
--   * a stage to sit under — project_phases already are those stages
--   * a way to mark a presentation date, which their sheet paints red
-- #############################################################################

-- A phase belongs to the project its tasks are in; nothing enforces that
-- across the FK, so the API checks it and this index makes the check cheap.
CREATE INDEX IF NOT EXISTS project_phases_pos_idx ON project_phases(project_id, position);
