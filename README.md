# LocalFin AI

Local-first personal finance tracker with AI-assisted transaction parsing, categorization, dashboards, account linking, and SQLite-backed storage.

## Prerequisites

- Node.js and npm compatible with the checked-in `package-lock.json`.
- A local `.env` copied from `.env.example`.
- `OPENROUTER_API_KEY` for AI parsing, categorization, and assistant features.
- Provider credentials only when using Plaid or Akoya account linking.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in secret values in `.env`. Do not commit `.env`, `data/budget.db`, logs, or generated cache artifacts.

## Development

```bash
npm run dev           # Express on 3001, then Vite on 5173 after /api/health is ready
npm run dev:server    # Express only via tsx watch
npm run dev:client    # Vite only, proxies /api to 127.0.0.1:3001
npm run preview       # preview a production build
```

The default database path is `data/budget.db`; override with `LOCALFIN_DB_PATH` or `LOCALFIN_DATA_DIR`.

## Checks

```bash
npm test              # server/**/*.test.ts
npm run test:frontend # src/**/*.test.ts
npm run lint          # ESLint
npm run typecheck     # tsc -b --pretty false
npm run build         # TypeScript build + Vite build
```

No format script is defined in `package.json`.

## Environment variables

Names only; keep values in `.env`.

- `OPENROUTER_API_KEY`
- `CORS_ORIGIN`
- `FRONTEND_BASE_URL`
- `LOCALFIN_DATA_DIR`
- `LOCALFIN_DB_PATH`
- `LOCALFIN_PROVIDER_SECRET`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV`
- `PLAID_REDIRECT_URI`
- `AKOYA_CLIENT_ID`
- `AKOYA_CLIENT_SECRET`
- `AKOYA_AUTH_BASE_URL`
- `AKOYA_API_BASE_URL`
- `AKOYA_REDIRECT_URI`
- `AKOYA_CONNECTOR`
- `AKOYA_PROVIDER_ID`
- `AKOYA_API_VERSION`
- `RUN_LIVE_AGENT_EVAL`
- `AGENT_EVAL_LIMIT`
- `AGENT_EVAL_KEEP_DBS`

## Project map

- `src/` — React frontend, route pages, feature state, hooks, API client, query keys.
- `server/` — Express app, route handlers, services, SQLite schema/connection, AI/provider integrations.
- `scripts/` — local operational scripts and log rendering.
- `.omp/skills/` — OMP skills. Read the relevant `skill://<name>` before following a repo-specific workflow.

## OMP notes

- Use repo-local commands above and package scripts as the source of truth.
- Do not read or modify `docs/scratchpad.md`.
- Do not commit secrets, `data/*.db*`, logs, `dist/`, or generated cache artifacts.
- Use `skill://optimize-repo-skills` when the skill set needs review, pruning, or expansion.
