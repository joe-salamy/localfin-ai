# LocalFin AI

Local-first personal finance tracker with deterministic statement parsing, dashboards, account linking, SQLite-backed storage, and plug-and-play REST + MCP for external agents.

## Bring your own agent

Run `npm run dev` (Express on `127.0.0.1:3001`, Vite on `5173`), read `.omp/skills/localfin-api/SKILL.md`, then call `GET /api/openapi.json` or `npm run mcp` (stdio MCP with `localfin_*` tools). No embedded chat — any OMP/Claude/Codex agent can consume the same REST envelope `{success, data, error}` or MCP tools.

## Prerequisites

- Node.js and npm compatible with the checked-in `package-lock.json`.
- A local `.env` copied from `.env.example`.
- Provider credentials only when using Plaid or Akoya account linking.
- External LLM key only if your agent uses `.omp/skills/localfin-categorization` — server no longer calls OpenRouter (`OPENROUTER_API_KEY` optional, see `.env.example`).

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
npm run mcp           # stdio MCP server (localfin_* tools)
npm run mcp:inspect   # inspector for MCP
```

The default database path is `data/budget.db`; override with `LOCALFIN_DB_PATH` or `LOCALFIN_DATA_DIR`. Audit log: `logs/jsonl/audit-YYYY-MM-DD.jsonl`.

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

- `OPENROUTER_API_KEY` (optional — external agents only; server no longer uses it)
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

## Project map

- `src/` — React frontend, route pages, feature state, hooks, API client, query keys.
- `server/` — Express app, route handlers, services, SQLite schema/connection, provider integrations, `server/mcp` stdio server, `server/middleware/audit-log.ts`.
- `server/routes/openapi.ts` — `GET /api/openapi.json` (and `/api/openapi`).
- `shared/` — Zod contracts, validation, finance invariants.
- `scripts/` — local operational scripts and `render-log-html` viewer.
- `.omp/skills/` — OMP skills. Read the relevant `skill://<name>` before following a repo-specific workflow:
  - `localfin-api` — REST/MCP endpoints, envelope, CORS, loopback bind
  - `localfin-finance-invariants` — amount/kind, reference, tag, bulk rules
  - `localfin-categorization` — transfer heuristic, available subcategories, LLM flow
  - `localfin-workflows` — budget setup, messy capture, search/correction
  - `localfin-react-query-ui` — React Query patterns

## OMP notes

- Use repo-local commands above and package scripts as the source of truth.
- Do not read or modify `docs/scratchpad.md`.
- Do not commit secrets, `data/*.db*`, logs, `dist/`, or generated cache artifacts.
- Use `skill://optimize-repo-skills` when the skill set needs review, pruning, or expansion.
