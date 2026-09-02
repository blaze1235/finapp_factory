# Account Manager

Project and client management for a creative agency — with a client portal and
a Telegram Mini App. Built on the [`platform-template`](https://github.com/blaze1235/platform-template)
core (database-per-tenant, phone+PIN auth, backups), with the agency domain and
row level security layered on top.

---

## The two things this exists for

Everything else here exists in ClickUp. These two do not, and they are the
reason it was worth building.

### 1. Client visibility, enforced by the database

Every task, comment and file is `internal` or `client_visible`. Clients see
only what is flagged, only on their own company's projects.

That rule lives in `lib/schema.sql` as **row level security policies**, not in
application code. A route that forgets a filter returns nothing extra. To make
that real:

- The app connects as a Postgres superuser (it creates a database per agency),
  and **superusers bypass RLS entirely** — so `lib/rls.js` issues
  `SET LOCAL ROLE am_app` inside every request transaction. `am_app` is an
  unprivileged role, so the policies actually apply.
- Identity travels as three session settings the policies read:
  `app.user_id`, `app.role`, `app.company_id`. All are transaction-scoped, so a
  pooled connection can never carry one person's identity into the next
  person's request.
- An unconfigured session resolves to role `none` and sees **nothing**. It
  fails closed.

RLS is row-level, so it does not stop a client's own task row from carrying the
internal `due_date` column next to the padded `client_due_date`. The portal
therefore reads only the `v_client_*` views, which list their columns explicitly
and are declared `security_invoker = true` so RLS still applies through them.
A column added to a table later is private until someone adds it to a view.

**Two deadline fields exist deliberately.** `due_date` is internal and real;
`client_due_date` is padded and is what the client is told. A CHECK constraint
stops the client date being earlier than the internal one.

### 2. The approval and revision chain

```
work → sent for approval → client approves        → done
                        └→ client requests changes
                             → revision counter increments
                             → revision task auto-created and assigned
                             → past the agreed rounds: the owner is warned NOW
                             → owner absorbs it, or bills it as extra scope
```

This is a **database trigger** (`trg_approval_chain`), not application code, so
the counter cannot drift from the record and no surface can skip the counting —
the Telegram bot and the portal both write to the same `approvals` table.

Each project carries `revisions_included`, captured at creation from the signed
scope. Billing extra scope creates the invoice line immediately, so the money
reaches the accountant without anyone remembering it three weeks later.

Approvals are permanent: clients have no UPDATE or DELETE policy on that table.

---

## What changed in v2 (client's revised spec)

Three decisions here **reverse** what the first brief asked for, at the client's
written request. They are marked REVERSAL in `lib/schema.sql` so nobody later
"fixes" them back:

| First brief | Now |
|---|---|
| "Assignee names are shown to clients. The client asked for this." | Team members are **not** visible on the client's view. `v_client_tasks` no longer carries `assignee_id` at all, so no portal query can reintroduce it. |
| "Deliberately no per-person productivity counts." | Full performance tracking: difficulty points, festival badges, monthly reset, plus an owner-facing stats table. |
| Five pipeline stages | Six named ones: Brief → Concept → Production → Review → Approval → Delivery |

**One judgement call.** §9 describes accounts and a transactions ledger and
never mentions invoices or line items, so the invoices/payments model collapsed
into that ledger rather than running two overlapping ones. An income row with
`settled = false` **is** "unpaid to us" — it lifts profit and leaves cash alone,
which is exactly the profit-vs-cash split §9 asks to be displayed. Existing
invoices are migrated into transactions on deploy, then the old tables dropped.

Also new: a fifth permission level (**Editor** — assigns work, no finance),
My tasks, Calendar/Timeline with owner-editable phases, client contacts,
join links that let an invitee set their own PIN, Documents for clients,
a Settings page, and weekly progress snapshots so the report can show where
each project stood on Monday against where it stands now.

## The timeline (§6, revised)

The client's reference for "calendar" turned out to be a planning sheet, not a
portfolio view: **rows are processes grouped by stage, columns are working
days, and each cell is coloured by state** — grey planned, yellow in progress,
green done, red for a presentation date. `public/gantt.js` reproduces that
structure and is shared by the agency view and the client portal, because two
renderers drawing the same dates would eventually disagree about them.

What it does that the spreadsheet cannot:

- a run of days is **one rounded bar**, not a row of hard cells
- the date header and the process column are **pinned on both axes** in a
  single scroll container, so neither is lost on a chart that is wider than the
  screen and taller than the window
- **weekends are absent** rather than greyed — from `settings.working_days`, so
  an agency that works Saturdays gets Saturdays
- today is a line you can find without counting columns
- status is **derived from the task**, so it cannot read "done" while the work
  sits open
- every bar is a button that opens the task
- the owner can toggle **⇥ Zaxira** to see the padding between the real date and
  the one the client was told, drawn as a dashed outline behind the bar

Tasks gained `starts_on` (a span instead of a due day), `phase_id` (the stage
rail — `project_phases` already modelled exactly those stages), and
`is_meeting` (their red cells). Each has a client-facing twin where it matters:
the portal grid is built from `v_client_*` only, so it carries the padded dates
and never the internal ones.

## Roles

| Role | Sees | Enforced by |
|---|---|---|
| **Owner / Account manager** | Everything | — |
| **Accountant** | Finance, clients, projects. **No tasks at all** — not a filtered view of tasks, none. | No policy on `tasks` for this role |
| **Editor** | Their own projects, and may assign work to other people. No finance. | RLS + `trg_task_field_guard` |
| **Member** | Their own projects; updates their own tasks. Cannot assign. | RLS + `trg_task_field_guard` |
| **Client** | Only client-visible items on their own company's projects, and never who is doing them | RLS + the `v_client_*` views |

Neither an editor nor a member can change visibility, client deadlines, the
revision counter, a task's difficulty, or write work off as missed — the last
two because they decide points.

The owner account is created at provisioning and there is no invite path to it.

A per-resource view/edit/approve/manage matrix was deliberately deferred: at
6–8 people every cell resolves the same way, and an unused matrix is just a way
to get a cell wrong.

---

## Telegram

The agency already lives in Telegram, so the bot is a first-class surface, not
a notification pipe. With no `TELEGRAM_BOT_TOKEN` set, all of it goes quiet and
the rest of the product is unaffected.

- **Voice-note briefs.** Send the bot a voice note; it stores the audio, offers
  your active projects as buttons, and one tap files it as a task with the
  recording attached. No transcription service and no monthly bill — the
  recording stays there for whoever picks the work up.
- **One-tap decisions.** A client gets *Approve* / *Request changes* buttons the
  moment something is sent to them. Requesting changes prompts for a reason and
  writes it through the same `approvals` table, so the counter still moves.
- **The scope warning**, with *Absorb it* / *Bill it* attached to the message,
  at the moment it happens.
- `/waiting`, `/mine`, `/week`.
- **Mini App** (`/tg/`): Telegram signs `initData`, so a linked person never
  sees a login screen.

Linking uses a single-use code from Settings → Telegram; a PIN is never typed
into a chat window.

---

## Running it

```bash
npm install
createdb am_control
DATABASE_URL=postgres://localhost:5432/am_control npm run seed
DATABASE_URL=postgres://localhost:5432/am_control npm start
```

The seed creates a demo agency with a scope warning already live on the
dashboard. Logins are printed when it finishes.

### Onboarding a real agency

```bash
node scripts/provision-tenant.js "Agency Name" CODE "Owner Name" +998901112233 1234
```

Arguments are validated, because `railway ssh -- <cmd>` re-joins arguments
through `sh` without preserving quotes and a name with a space silently shifts
every later argument.

### Tests

```bash
npm test
```

`scripts/flow-test.js` drives the whole product over real HTTP against a
throwaway agency, then drops it — **158 checks**. The visibility ones are the point;
each is a client relationship that a forgotten filter would have destroyed. The
last section re-proves the boundaries **with every route bypassed**, querying
the database directly as each role, so the routes could all be wrong and it
would still have to hold.

---

## Answers to the open questions in the brief

1. **Progress percentage** — weighted by how far along each deliverable is
   (`task_weight` in `schema.sql`), not completed-over-total, which jumps.
   Defined once in SQL so the portal and the dashboard cannot quote different
   numbers. Always displayed next to a plain "N of M delivered" count, so the
   weighting can never be mistaken for a completion claim.
2. **Pipeline stage** — set by hand, but the UI proposes the next stage once
   nothing in the current one is outstanding, and the owner accepts with one
   click. Automatic stages lie; unattended manual ones rot.
3. **`revisions_included`** — required at project creation. `POST /api/projects`
   returns 400 without it rather than defaulting quietly, because unset means
   the scope warning never fires and the flagship feature is decorative.
4. **Comment history on a visibility switch** — only comments written *after*
   the switch. `tasks.client_visible_from` is stamped the first time a task
   opens up, and the RLS policy on `comments` compares against it. Opening a
   task never retroactively exposes the arguing that happened while it was shut.
5. **Uzbek script** — Latin by default, with Russian and English alongside
   (`STRINGS` in `public/kit.js`). Notifications raised by database triggers
   carry structured `params`, so they render in the reader's language instead
   of whatever language the trigger was written in.
6. **File retention** — uploads are capped (`FILE_MAX_MB`, default 25) and land
   on the Railway volume at `FILES_DIR`. Over the cap the API refuses and asks
   for a link instead: video deliverables belong on a link, not in the database.
   `files.external_url` is a first-class alternative to `storage_path`.

---

## Deliberate omissions

- **No in-app chat.** Conversation stays in Telegram; this app captures
  *decisions*. A chat box would let client feedback arrive without being counted
  as a revision round, which defeats the point. Clients have SELECT on
  `comments` and no INSERT.
- **Clients see three buckets, not five statuses.** `in_review` is internal
  business and reads as "in progress". Anything actually waiting on them is
  pulled out as an action rather than left as a status.
- **Assignee names are shown to clients.** The client asked for it; the
  trade-off is understood. A name, never a phone number or a workload.
- **The weekly report measures the agency, not individuals.** Shipped, slipped,
  waiting on clients, revision rounds burned — deliberately no per-person
  productivity counts. Teammates get only their own week.

---

## Layout

```
lib/schema.sql      the access-control document — read this first
routes/performance.js one dataset, two framings: leaderboard vs management table
routes/calendar.js  all-projects timeline, and owner-editable phases per project
lib/rls.js          the only sanctioned way to touch a tenant database
lib/telegram.js     bot, Mini App auth, outbound
lib/alerts.js       daily nags: late work, stale approvals, undecided scope
routes/             portal (clients) is mounted before the staff routers
public/             agency app · portal/ · tg/  — three surfaces, one stylesheet
scripts/flow-test.js  75 checks over real HTTP
```

`public/portal/` ships none of the agency application.
