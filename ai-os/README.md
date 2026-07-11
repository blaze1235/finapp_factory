# AI OS — Virtual Office

Abdulaziz's personal AI agent office: a pixel-art startup HQ where departments of
specialist AI agents (powered by Gemini) execute real multi-agent work on the
Project Ablaze portfolio.

## Departments (v1)

| Room | Lead | Workers |
|------|------|---------|
| Marketing & Design | Mira (research) | Kai (copy), Zara (design), Leo (growth) |
| BlazeRent Growth | Dana (product) | Rex (retention), Nova (partnerships), Max (data) |
| Finance & Analytics | Vera (analysis) | Omar (budget), Lina (forecasting) |
| Second Brain | Sage (knowledge) | Iris (research), Theo (assistant) |

## How it works

1. You drop a task brief (optionally pinned to a department).
2. The **Master Orchestrator** (Gemini) picks the department and decomposes the brief
   into 2–4 subtasks for specific workers.
3. Each worker runs its own Gemini call with its persona + portfolio context,
   building on teammates' outputs sequentially.
4. The **team lead** synthesizes everything into one vault-ready Markdown deliverable
   (downloadable as `.md` for Obsidian).
5. The pixel office animates live: rooms glow, agents bob and type, the feed ticks.

## Stack

Next.js 15 (App Router) · React 19 · Tailwind 4 · Postgres (`postgres` driver, raw SQL) ·
Google Gemini (`@google/genai`) · single-user cookie auth.

## Run locally

```bash
npm install
cp .env.example .env   # fill DATABASE_URL, GEMINI_API_KEY, AUTH_*
npm run db:migrate
npm run dev
```

## Deploy (Railway project "ai-os")

- `web` service: `railway up -s web`. Start command runs migrations automatically.
- `Postgres` service: Railway managed Postgres; `DATABASE_URL` is referenced via
  `${{Postgres.DATABASE_URL}}` on the web service.
- Required env vars on `web`: `DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
  `AUTH_PASSWORD`, `AUTH_SECRET`.
