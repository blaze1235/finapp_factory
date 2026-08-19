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

## Roles

| Role | Sees | Enforced by |
|---|---|---|
| **Owner / Account manager** | Everything | — |
| **Accountant** | Finance and client records. **No tasks at all** — not a filtered view of tasks, none. | No policy on `tasks` for this role |
| **Teammate** | Projects they are a member of. No finance. Cannot change visibility, assignees, client deadlines or the revision counter. | RLS + `trg_task_field_guard` |
| **Client** | Only client-visible items on their own company's projects | RLS + the `v_client_*` views |

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
throwaway agency, then drops it — 75 checks. The visibility ones are the point;
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
lib/rls.js          the only sanctioned way to touch a tenant database
lib/telegram.js     bot, Mini App auth, outbound
lib/alerts.js       daily nags: late work, stale approvals, undecided scope
routes/             portal (clients) is mounted before the staff routers
public/             agency app · portal/ · tg/  — three surfaces, one stylesheet
scripts/flow-test.js  75 checks over real HTTP
```

`public/portal/` ships none of the agency application.
