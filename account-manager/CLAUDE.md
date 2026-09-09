# Working on Account Manager

Read this before changing anything. Most of it is not style preference — it is
the short list of things that break **silently**, with no error and no failing
page, and are only caught by the test suite or by a client seeing something
they should not have.

## How to contribute

You push as **yourself** — no shared credentials exist for this repo. Sign in
once with `gh auth login`, then:

```bash
git checkout -b your-change
# ... work, and run the suite (below) ...
git push -u origin your-change
gh pr create --fill
```

**Do not push straight to `main`.** The repo is private on a free plan, where
GitHub cannot enforce that for us — so it is a convention rather than a lock,
and it depends on you. CI still runs on every push and every pull request, so a
break shows up immediately either way; check it before merging.

Deployment is not automatic: production is released separately, from a local
`railway up`. Merging to `main` does not ship anything to the live agency.

## Run the tests. Always.

```bash
createdb am_control
DATABASE_URL=postgres://localhost:5432/am_control npm run seed
DATABASE_URL=postgres://localhost:5432/am_control PORT=3111 npm start   # in one shell
DATABASE_URL=postgres://localhost:5432/am_control BASE=http://localhost:3111 npm test
```

**166 checks.** They drive real HTTP against a throwaway agency and then drop
it. The last section re-proves every visibility boundary **with the routes
bypassed entirely**, querying the database directly as each role — so the
routes could all be wrong and it would still have to hold. If you change a
policy, a view, or anything about who sees what, this suite is the only thing
that will tell you that you got it wrong.

CI runs the same suite on every push and pull request.

## The six things that break silently

### 1. RLS only applies because the app drops privileges

Postgres **superusers bypass row level security entirely**, and the app's
`DATABASE_URL` is a superuser (it creates a database per agency). `lib/rls.js`
issues `SET LOCAL ROLE am_app` inside every request transaction. Remove that
line and every policy in `lib/schema.sql` stops applying — no error, no warning,
just an application that quietly shows everyone everything.

Never query a tenant table outside `withRls()`. Routes are given `req.q` and
`req.sql`, and deliberately **not** a raw pool, so this is hard to do by
accident. Keep it that way.

### 2. RLS is row-level. Columns are your problem.

A client can legitimately see their own task row — and that row carries
`due_date` (the internal deadline) right next to `client_due_date` (the padded
one they were told). One `SELECT *` in a portal query hands them both.

**The portal reads only the `v_client_*` views.** They list their columns
explicitly and are declared `security_invoker = true`, which is what keeps RLS
applying through them. Never point a client-facing route at a base table. A
column added to a table later is private until someone deliberately adds it to
a view — that default is intentional.

### 3. `lib/schema.sql` is applied top to bottom, in one shot

Ordering is load-bearing and has broken twice:

- new task columns must be created **after** `project_phases` (the foreign key)
- and **before** the `v_client_*` views that select them

`CREATE OR REPLACE VIEW` also cannot drop or reorder columns — if a view's
shape changes, `DROP VIEW` first. The file must apply cleanly **three times in a
row** on a fresh database and as an upgrade to an existing one.

### 4. There is no self-signup, for anyone, ever

The owner is the only account that signs itself in. Every other login —
teammate, accountant, editor, or a client's own portal access — is created
directly by the owner through `POST /api/team`, PIN and (optionally) Telegram
ID included. A prior version of this app had a public join-link flow where the
invitee picked their own PIN; it is gone, on purpose, and should not come back
without being asked for. See "Access is granted, never requested" in the
README.

### 5. Three decisions REVERSE the original brief

They are marked `REVERSAL` in `lib/schema.sql`. They look like bugs if you only
read the first brief. Do not "fix" them:

- **Clients are not shown who is doing the work.** `assignee_id` is gone from
  `v_client_tasks` entirely.
- **Per-person performance is tracked and ranked.** The first brief refused
  this; the client asked for it in writing.
- **Six named pipeline stages**, not five.

### 6. There are no invoices

`invoices` / `invoice_lines` / `payments` were migrated into `transactions` and
dropped. An income row with `settled = false` **is** "unpaid to us": it lifts
profit and leaves cash alone. That split is why the finance page shows profit
and cash movement as two different numbers. Do not reintroduce an invoice model
alongside the ledger.

## Smaller things that cost real time

- `Object.assign(el.style, {...})` **silently ignores CSS custom properties**.
  An element styled `background: var(--c)` set that way renders as nothing, with
  no error. The `h()` helper in `public/kit.js` routes `--*` through
  `setProperty`. Suspect this first when something is positioned correctly but
  paints nothing.
- An **absolutely positioned element cannot be `position: sticky`**. Headers
  that must survive scrolling have to be flow children of a wrapper.
- A Postgres `DATE` is a calendar day, not an instant. `lib/conn.js` parses type
  1082 as a plain string on purpose — letting node-pg build a `Date` shifts
  deadlines by a day for anyone east of Greenwich.
- A pooled connection whose database is dropped keeps dead clients. Call
  `evictTenantPool()` before dropping, and never remove the `pool.on('error')`
  handler in `lib/tenant-pool.js` — an unhandled pool error takes the process
  down.
- Session tokens are **header-only**. Downloads use a separate five-minute,
  single-file token; putting the session token in a URL leaks it into logs,
  history, and the `Referer` of the redirect out to Drive.
- Native `Element.append(a, b, null, c)` does **not** skip `null` the way this
  file's own `h()` helper does — it calls `String(null)` and inserts the
  literal text "null" onto the page, silently, no error. `h()`'s internal
  `add()` filters falsy children; a raw `.append(...)` call with a conditional
  in it does not, and needs `[...].filter(x => x != null)` by hand
  (`editPerson()` in `public/app.js` is the example to copy).
- `lib/team.js`'s `getTeam()` is the one place a person's row is assembled for
  the rest of the app. If a column exists on `users` but a caller reads
  `undefined` for it, check this `SELECT` first — it has silently omitted a
  whole batch of profile columns before (title, responsibility, email,
  work_mode, birthdate, avatar_color all went missing for a full release), and
  nothing broke loudly. It's a plain function call, not RLS, so nothing
  enforces its shape but the tests.

## Layout

```
lib/schema.sql        the real access-control document — read this first
lib/rls.js            the only sanctioned way to touch a tenant database
lib/telegram.js       bot, Mini App auth, outbound
routes/               portal (clients) is mounted BEFORE the staff routers,
                      because those apply a staff-only gate to all of /api
public/               agency app · portal/ · tg/
public/gantt.js       the dense weekday operating grid
public/roadmap.js     the presentation timeline (continuous time)
scripts/flow-test.js  158 checks over real HTTP
```

`public/portal/` ships none of the agency application.

## Secrets

Nothing secret belongs in the repo. `.env.example` lists every variable; real
values are Railway environment variables. `SESSION_SECRET` unset in production
means every token the process signs is forgeable — the server warns on boot.
