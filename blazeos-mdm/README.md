# BlazeOS MDM

Multi-tenant device-financing (nasiya) control platform for iPhones. BlazeOS
owns one Apple Business Manager org + MDM server; partner stores are tenants
that enroll the phones they sell and lock them on missed payments.

This repo is the **application layer** — the part BlazeOS owns end to end. The
actual Apple MDM protocol work (APNs push, CMS-signed commands, ABM/DEP
enrollment) is delegated to a self-hosted **NanoMDM** server behind a clean
provider interface (`server/src/mdm/`). Until NanoMDM + a real ABM org are
wired up (Phase 1), it runs against a mock provider so the whole flow is
testable locally.

## Stack

- **server** — Node + TypeScript + Express + Prisma + PostgreSQL. JWT auth,
  role-based access control, tenant scoping, the lock engine, and the
  overdue-evaluation job.
- **web** — React + Vite + Tailwind dashboard.

## Roles

| Role | Scope | Can |
| --- | --- | --- |
| `MAIN_ADMIN` | all stores | manage stores, see everything, lock/unlock, suspend stores |
| `STORE_ADMIN` | own store | manage their buyers/devices/contracts, lock/unlock |
| `STORE_STAFF` | own store | enroll devices, record payments — **not** lock/unlock |

Buyers are not users; they only see the standard iOS management screen on their phone.

## Run locally

Prereqs: Node 20+, PostgreSQL running, a `blazeos` database.

```bash
# 1. Server
cd server
npm install
cp .env.example .env          # set DATABASE_URL + JWT_SECRET
npx prisma db push            # create tables
npm run seed                  # demo stores, buyers, devices, contracts
npm run dev                   # http://localhost:4000

# 2. Web (separate terminal)
cd web
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :4000)
```

Demo logins (from the seed):

- Main admin — `admin@blazeos.dev` / `admin123`
- Store admin — `admin@tashkentmobile.uz` / `store123`
- Store staff — `staff@tashkentmobile.uz` / `store123`

## The core flow

1. Store enrolls a device (ABM assignment + supervised, non-removable profile).
2. A contract generates a monthly payment schedule.
3. The **overdue job** (`npm run evaluate-overdue`, or the dashboard button)
   locks any device whose payment is more than `OVERDUE_GRACE_DAYS` late, and
   unlocks ones that have caught up.
4. Recording a payment that clears all overdue amounts unlocks the device
   automatically. The final payment marks the contract paid off.
5. Every lock/unlock/enroll/remove is written to `lock_events` for audit.

## Deploy (Railway)

Deployed as a **single service** (the Express server serves both the API and
the built React app) plus a **PostgreSQL** plugin. Config lives in
`nixpacks.toml` + the root `package.json`.

- Build: installs `server` + `web`, builds both, generates the Prisma client.
- Start (`server` `start:prod`): `prisma db push` applies the schema, then
  `bootstrap` seeds demo data **only if the database is empty** (safe on every
  redeploy — it never wipes data), then the server starts.

Required env vars on the service:
- `DATABASE_URL` — provided by the Railway Postgres plugin (reference it).
- `JWT_SECRET` — a long random string.
- `MDM_PROVIDER=mock`, `NOTIFY_PROVIDER=mock` until Phase 1.

From the `blazeos-mdm/` directory, after `railway login`:

```bash
railway init        # create the project
railway add         # add a PostgreSQL database
railway up          # build + deploy this directory
```

Then set `JWT_SECRET` and reference `DATABASE_URL`, and generate a domain.

## Going to production (Phase 1)

1. Register BlazeOS as a business + get a D-U-N-S number.
2. Enroll in Apple Business Manager; generate an APNs push certificate.
3. Stand up NanoMDM, point `NANOMDM_URL` / `NANOMDM_API_KEY` at it.
4. Implement the real command payloads in `server/src/mdm/nanomdm.ts`
   (EnableLostMode / DisableLostMode / RemoveProfile / ABM assignment).
5. Switch `MDM_PROVIDER=nanomdm`.

See the BlazeOS MDM — Platform Plan doc for the full roadmap, pricing, and risks.
