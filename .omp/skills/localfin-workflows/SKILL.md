---
name: localfin-workflows
description: Use for multi-step LocalFin tasks (budget setup, messy capture, bulk corrections)
---

# LocalFin Workflows

Distilled from `docs/agent-use-cases.md` and `server/services/ai-chat/prompting.ts:72-76`. Each workflow uses `GET /api/openapi.json` for shapes, `localfin-*` MCP tools as alternative, and handles 409 duplicate-name partial failures (`server/services/action-executor` pattern: valid actions persist, invalid return error).

## 1. Budget setup

**Goal:** Create accounts → categories → subcategories → goals in order; handle duplicates without blocking siblings.

Steps:

1. Accounts: `POST /api/accounts` or `localfin_create_account` with `{name, type: asset|liability, initial_balance?, color?: hex}`. On 409 duplicate `name`, fetch `GET /api/accounts` and reuse existing id.
2. Categories: `POST /api/categories` with `{name, type: income|expense, color?}`. Same 409 handling via `GET /api/categories`.
3. Subcategories: `POST /api/subcategories` with `{name, category_id, monthly_goal?, color?}`. Resolve `category_id` from step 2; 409 on `(name, category_id)` → reuse.
4. Goals: `POST /api/goals` or `localfin_create_goal` with `{subcategory_id, amount>0, period: weekly|monthly|quarterly|annual, start_date: YYYY-MM-DD, end_date?: YYYY-MM-DD|null}`. One goal per subcategory; 409 if exists → `PUT /api/goals/:id` if user wants update. Validate `start_date <= end_date`.
5. Verify: `GET /api/dashboard/account-summary?startDate=&endDate=` etc., or `localfin_dashboard` with date range. Show partial failures in summary.

Example order: checking/savings accounts → Food/Bills categories → Groceries/Restaurants under Food → monthly grocery target 400 starting 2026-01-01.

## 2. Messy transaction capture

**Goal:** Turn `Add Whole Foods 48.23 and Uber 21.50 yesterday from checking.` into correct rows.

Steps:

1. Resolve names: `GET /api/accounts` + `GET /api/subcategories` to map `checking` → account id, potential subcategory via `localfin-categorization` heuristic. Never invent ids.
2. Normalize dates: `YYYY-MM-DD`; `yesterday` = `today-1` via `new Date().toISOString().slice(0,10)`. Timezone: agent local date.
3. Pick kind & amount sign: use `localfin-finance-invariants` → `inferTransactionKindForAccount` + `normalizeTransactionAmount`. Example: 48.23 expense on asset → delta -48.23; 32.10 reimbursement (income) on asset → +32.10; credit card payment between owned accounts → `kind: transfer`, no subcategory.
4. Tags: only if user says `tag/tagged` or `tag it as X`; resolve via `GET /api/tags`, default type `custom`.
5. Write: `POST /api/transactions` single or `POST /api/transactions/bulk` (`localfin_bulk_create_transactions`) with `{account_id, date, name, amount, kind?, subcategory_id?, tag_ids?, comment?}`. Use bulk for multiple.
6. If statement pasted: `POST /api/parser/parse-statement` → `ParseStatementResult` deterministic; then apply categorization skill to fill `subcategory_id`, then bulk create.

Acceptance: created rows have expected account, ISO date, signed amount, kind, subcategory, comment; missing refs surface as visible errors.

## 3. Search / correction

**Goal:** `Find Uber Trip but not Eats and mark it Rideshare.` / `Search comment:"work trip" OR name:"hotel" -reimbursed, then update hotel comment.` / `Mark every monthly maintenance fee as Bank Fees.`

Steps:

1. Search: `GET /api/transactions?searchQuery=` (MCP `localfin_search_transactions`). Grammar from `prompting.ts:76` and `server/services/transaction-search.ts`: quoted phrases, `(parens)`, `AND/OR/NOT`, `|`, `-term`, fields `name:`, `comment:`, `account:`, `category:`, `subcategory:`, `tag:`/`tags:`, plus `amount>20`, `amount<=100`, `date>=2026-01-01`, `date:2026-01-01`. Show matches before write.
2. Single update: if one match and user intent unambiguous, `PUT /api/transactions/:id` (or `localfin_update_transaction`) with `{subcategory_id, name?, comment?, amount?, kind?, tag_ids?}`.
3. Bulk update: for `all`/`every` matching, use `PUT /api/transactions/bulk` (`localfin_bulk_update_transactions`) with `{ids, updates:{kind?, subcategory_id?, add_tag_ids?, remove_tag_ids?}}`.
4. Ambiguity: if 0 or >1 matches for a single-update request, report and ask for clarification; do not guess.
5. Verify: re-run `searchQuery` after write and display changed fields only.

All three workflows log to `logs/jsonl/audit-*.jsonl` via generic middleware; inspect with `cat logs/jsonl/audit-$(date +%F).jsonl | jq`.

Reference: `GET /api/openapi.json` for schemas; do not duplicate full spec here. Keep skill <200 lines.
