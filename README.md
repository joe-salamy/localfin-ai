# LocalFin AI

Local-first personal finance tracker with deterministic statement parsing, SQLite-backed storage, and plug-and-play REST + MCP for external agents. Dashboard and transaction history render as one-time self-contained HTML reports, categorization runs as an ODS round-trip, and setup/settings/input go through omp REST/MCP — no dev client.

## Bring your own agent

Run `npm run dev` (Express on `127.0.0.1:3001`), read `.omp/skills/localfin-api/SKILL.md`, then call `GET /api/openapi.json` or `npm run mcp` (stdio MCP with `localfin_*` tools). No embedded chat — any OMP/Claude/Codex agent can consume the same REST envelope `{success, data, error}` or MCP tools. One-time reports: `npm run report:dashboard -- --start YYYY-MM-DD --end YYYY-MM-DD`, `npm run report:history -- ...`. Categorization loop: `npm run categorize:export -- <out.fods>`, `npm run categorize:apply -- <edited.fods>`. Statement input: `npm run ingest:csv -- --file <abs path> --account <name>`.

## Prerequisites

- Node.js and npm compatible with the checked-in `package-lock.json`.
- Optionally a local `.env` copied from `.env.example` to relocate the database.
- No API keys: `.omp/skills/localfin-categorization` uses your agent session's own model.

## Setup

```bash
npm install
cp .env.example .env
```

Do not commit `.env`, `data/budget.db`, logs, or generated cache artifacts.

## Development

```bash
npm run dev           # Express via tsx watch on 127.0.0.1:3001
npm run dev:server    # same as dev
npm run dev:archive   # archive helper
npm run mcp           # stdio MCP server (localfin_* tools)
npm run mcp:inspect   # inspector for MCP
npm run report:dashboard -- --start YYYY-MM-DD --end YYYY-MM-DD [--out path]
npm run report:history -- --start YYYY-MM-DD --end YYYY-MM-DD [--out path]
npm run categorize:export -- <out.fods> [--needs-category-only] [--limit N]
npm run categorize:apply -- <edited.fods> [--dry-run]
npm run taxonomy:export -- <out.fods>
npm run taxonomy:apply -- <edited.fods> [--dry-run]
npm run ingest:csv -- --file <abs path> --account <name> [--out review.fods] [--dry-run]
```

The default database path is `data/budget.db`; override with `LOCALFIN_DB_PATH` or `LOCALFIN_DATA_DIR`. Audit log: `logs/jsonl/audit-YYYY-MM-DD.jsonl`.

## Checks

```bash
npm test              # test:server (server/**/*.test.ts) + test:scripts (scripts/**/*.test.ts)
npm run lint          # ESLint
npm run typecheck     # tsc -b --pretty false
npm run build         # tsc -b
```

No format script is defined in `package.json`.

## Environment variables

Names only; keep values in `.env`.

- `LOCALFIN_DATA_DIR`
- `LOCALFIN_DB_PATH`

## Project map

- `server/` — Express app, route handlers, services, SQLite schema/connection, `server/mcp` stdio server, `server/middleware/audit-log.ts`.
- `server/routes/openapi.ts` — `GET /api/openapi.json` (and `/api/openapi`).
- `shared/` — Zod contracts, validation, finance invariants.
- `scripts/` — local operational scripts: `render-dashboard-html` / `render-history-html` one-time reports, `export-categorize-ods` / `apply-categorize-ods` ODS round-trip, `ingest-statement-csv` CSV intake.
- `.omp/skills/` — OMP skills. Read the relevant `skill://<name>` before following a repo-specific workflow:
  - `localfin-api` — REST/MCP endpoints, envelope, loopback bind
  - `localfin-finance-invariants` — amount/kind, reference, tag, bulk rules
  - `localfin-categorization` — transfer heuristic, available subcategories, exact-match prefill
  - `localfin-workflows` — budget setup, messy capture, search/correction

## OMP notes

- Use repo-local commands above and package scripts as the source of truth.
- Do not read or modify `docs/scratchpad.md`.
- Do not commit `data/*.db*`, logs, `dist/`, or generated cache artifacts.
