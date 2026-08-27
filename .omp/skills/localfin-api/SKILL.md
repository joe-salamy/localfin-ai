---
name: localfin-api
description: Use when calling LocalFin finance endpoints or MCP tools
---

# LocalFin API

Plug-and-play finance endpoints for external agents (OMP, Claude, Codex). No embedded chat required.

## Base

- Server: `http://127.0.0.1:3001` (loopback-only bind in `server/index.ts:16`; unauthenticated API deliberately binds to 127.0.0.1 only)
- CORS: `server/config/app.ts:5 SERVER_CONFIG.defaultCorsOrigins = "http://localhost:5173,http://127.0.0.1:5173"` — split by comma, origin allowed if missing or in set
- Spec: `GET /api/openapi.json` (pure JSON, no auth; also mounted at `/api/openapi` via `openApiRouter`). Full shape in `server/routes/openapi.ts`; do not duplicate here — fetch the live spec.

## Routes (`server/config/app.ts:9 API_ROUTES`)

| Route | Methods |
|---|---|
| `/api/health` | GET `{ok:true, timestamp}` |
| `/api/accounts` | GET, POST, GET/:id, PUT/:id, DELETE/:id, POST/:id/restore, POST/:id/reconcile, GET/:id/transaction-count |
| `/api/categories` | GET, POST, PUT/:id, DELETE/:id, POST/:id/restore |
| `/api/subcategories` | GET, GET/by-category/:categoryId, POST, PUT/:id, DELETE/:id, POST/:id/restore |
| `/api/tags` | GET, POST, PUT/:id, DELETE/:id, POST/:id/restore |
| `/api/transactions` | GET (filters + searchQuery), POST, GET/:id, PUT/:id, DELETE/:id, POST/:id/restore, POST/bulk, PUT/bulk, DELETE/bulk, POST/bulk/restore, POST/check-duplicates, POST/check-transfer, POST/suspect-scan, GET/suspect-findings, GET/recent-activity |
| `/api/dashboard` | GET/account-summary, GET/category-summary, GET/metrics, GET/charts/net-worth, GET/charts/sankey, GET/tag-summary |
| `/api/goals` | GET, POST, GET/:id, PUT/:id, DELETE/:id, GET/:id/progress |
| `/api/parser` | POST/parse-statement `{text, accountId}` → `ParseStatementResult` |
| `/api/account-linking` | GET/connections, POST/plaid/link-token, POST/plaid/exchange, POST/akoya/authorize, GET/akoya/callback, POST/sync, DELETE/connections/:id |
| `/api/openapi` + `/api/openapi.json` | GET spec `{openapi:"3.0.3", info, paths}` |

## Envelope

All routes use `shared/contracts/api.ts: ApiResponse<T> = {success:boolean, data?:T, error?:string}`. Validate with Zod schemas from `shared/contracts/*` and `shared/validation.ts`.

## Context fetch (how to become an agent)

1. `GET /api/openapi.json` → discover paths
2. `GET /api/accounts`, `GET /api/categories`, `GET /api/subcategories`, `GET /api/tags`, `GET /api/goals` → resolve names to ids (never invent ids)
3. `GET /api/dashboard/metrics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` + summaries for budget awareness
4. `GET /api/transactions?searchQuery=&limit=&offset=` for search-before-update

## MCP alternative

Stdio transport (primary). Run `npm run mcp` (`node --import tsx server/mcp/index.ts`). Tools: `localfin_list_accounts`, `localfin_create_account`, `localfin_update_account`, `localfin_list_categories`, `localfin_list_subcategories`, `localfin_create_category`, `localfin_update_category`, `localfin_create_subcategory`, `localfin_update_subcategory`, `localfin_list_tags`, `localfin_create_tag`, `localfin_update_tag`, `localfin_search_transactions`, `localfin_create_transaction`, `localfin_bulk_create_transactions`, `localfin_update_transaction`, `localfin_bulk_update_transactions`, `localfin_delete_transaction`, `localfin_restore_transaction`, `localfin_list_goals`, `localfin_create_goal`, `localfin_update_goal`, `localfin_dashboard`, `localfin_parse_statement`. Each validates with Zod strict schemas and returns `{content:[{type:"text", text: JSON.stringify(result)}]}` or `{isError:true, ...}` on `OperationalError`.

## Audit log

Mutating `POST|PUT|DELETE|PATCH` on `/api/*` (excluding `GET`, `/api/health`, `/api/openapi.json`) appends one JSON line to `logs/jsonl/audit-YYYY-MM-DD.jsonl` via `server/middleware/audit-log.ts` (`auditLog` before route mounts; file write failures log to `console.error` and never block). Fields matching `*secret*|*key*|*token*|PLAID*|AKOYA*` are redacted to `[REDACTED]`. Use `GET /api/openapi.json` and REST or MCP for all finance work.
