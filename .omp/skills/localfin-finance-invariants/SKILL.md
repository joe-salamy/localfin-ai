---
name: localfin-finance-invariants
description: Use when creating/updating finance records
---

# LocalFin Finance Invariants

Distilled from `server/services/ai-chat/prompting.ts:55-78`, `server/services/ai-chat/action-executor.ts`, and `shared/finance/transactionAmounts.ts`. Follow these when creating or updating any finance record via REST (`/api/*`) or MCP (`localfin_*`).

## Amount & kind (never guess)

Amounts are **account-balance deltas**, normalized by `normalizeTransactionAmount(amount, accountType, kind)`:

- **Expense** / **income** / **transfer** / **adjustment** are distinct `transactionKindSchema` values (`shared/contracts/transactions.ts:170`).
- `asset` accounts: expense = negative delta (spending, groceries, rides, bills decrease balance), income = positive delta (payroll, refunds increase balance). `liability` is opposite: expense increases balance, income decreases balance. Transfers/adjustments are allowed any sign but still affect balances.
- Pick kind from **meaning**, not sign text. User `+`/`-` signs are clues only. Transfers move money between owned accounts, have **no subcategory**, and still affect balances. Adjustments reconcile balances, also have no subcategory.
- Infer kind when amount sign is given but kind omitted: `inferTransactionKindForAccount(amount, accountType)` (`shared/finance/transactionAmounts.ts:27`):
  - `amount===0` → `expense`
  - `liability`: `amount>0` → `expense`, else `income`
  - `asset`: `amount>0` → `income`, else `expense`

## References (never invent)

- User names are not ids. Resolve via `GET /api/accounts`, `GET /api/categories`, `GET /api/subcategories`, `GET /api/tags` (or MCP list tools) before any write. Prefer ids from context/tool results; pass `account_name`/`category_name`/`subcategory_name`/`current_name` only when the tool supports name resolution.
- After a failed write, inspect the error and correct only what is needed — do not repeat successful calls.
- Duplicate names surface as 409. Handle partial failures: valid actions persist, invalid ones return `error` in `ChatActionResult`-style summaries (now `{success:false, error}`).

## Tags (explicit-only)

From `prompting.ts:67-70`: use tag fields **only** when user says `tag`, `tagged`, or explicitly names a tag command like `tag it as Cabo Trip`, `add tag Reimbursable`, `remove tag Tax`, `for Cabo Trip trip`.

- Do not infer tags from merchants, locations, categories, names, or words like hotel/trip unless explicitly requested.
- Prefer existing tag ids from `GET /api/tags`. If explicitly requested and missing, pass `tag_names` or `tags` with `{name, type}` so the service can create it.
- Default tag type is `custom`; use `trip`/`event`/`person`/`reimbursable`/`tax` only when user's wording matches those (`tagTypeSchema` in `shared/contracts/tags.ts`).
- Creation uses `hexColorSchema` from `shared/validation.ts` (`/^#[0-9a-fA-F]{6}$/`); pass nullable or omit.

## Search-before-update & bulk

- When user describes a transaction without an id, call `GET /api/transactions?searchQuery=` (or `localfin_search_transactions`) first, then `PUT /api/transactions/:id` / `localfin_update_transaction` with an id from results (`prompting.ts:74`).
- Use `PUT /api/transactions/bulk` / `localfin_bulk_update_transactions` when user wants `all`/`every` matching transaction (`prompting.ts:75`). Bulk preference over looping single updates.

## Dates, colors, validation

- Dates: `YYYY-MM-DD` only via `isIsoDate` (`shared/validation.ts:5`). Normalize `today` to `new Date().toISOString().slice(0,10)` in agent locale.
- Colors: `hexColorSchema` nullable; omit when not provided.
- Amounts: `finiteNumber` (Zod `z.number().finite()`); transaction amounts rounded to cents via `roundCurrencyAmount`.
- Subcategories: transfers/adjustments must have `subcategory_id: null`; income/expense may have null but flagged as uncategorized. `needsCategory` filters income/expense with null subcategory.
- Goals: `amount >0`, `period` in `weekly|monthly|quarterly|annual`, `start_date <= end_date` when end provided; one goal per subcategory (409 if duplicate).
