---
name: localfin-finance-invariants
description: Use when creating/updating finance records
---

# LocalFin Finance Invariants

Grounded in `shared/finance/transactionAmounts.ts` and the service validation in `server/services/`. Follow these when creating or updating any finance record via REST (`/api/*`) or MCP (`localfin_*`).

## Amount & kind (never guess)

Amounts are **account-balance deltas**, normalized by `normalizeTransactionAmount(amount, accountType, kind)`:

- **Expense** / **income** / **transfer** / **adjustment** are distinct `transactionKindSchema` values (`shared/contracts/transactions.ts:170`).
- `asset` accounts: expense = negative delta (spending, groceries, rides, bills decrease balance), income = positive delta (payroll, refunds increase balance). `liability` is opposite: expense increases balance, income decreases balance. Transfers/adjustments keep the sign you give them: use the balance delta of *that* account. Money leaving checking is negative; a card payment lowers card debt, so it is negative on the card too (both sides of a checking → card payment are negative; checking → savings is negative then positive). Totals and transfer matching compare net-worth effect (`netWorthEffect`), not raw signs.
- Pick kind from **meaning**, not sign text. User `+`/`-` signs are clues only. Transfers move money between owned accounts, have **no subcategory**, and still affect balances. Adjustments reconcile balances, also have no subcategory.
- Infer kind when amount sign is given but kind omitted: `inferTransactionKindForAccount(amount, accountType)` (`shared/finance/transactionAmounts.ts:27`):
  - `amount===0` → `expense`
  - `liability`: `amount>0` → `expense`, else `income`
  - `asset`: `amount>0` → `income`, else `expense`

## References (never invent)

- User names are not ids. Resolve via `GET /api/accounts`, `GET /api/categories`, `GET /api/subcategories`, `GET /api/tags` (or MCP list tools) before any write. Every write takes ids, never names.
- After a failed write, inspect the error and correct only what is needed — do not repeat successful calls.
- Duplicate names surface as 409. Each call succeeds or fails on its own (`{success:false, error}`); retry only what failed.

## Tags (explicit-only)

Use tag fields **only** when user says `tag`, `tagged`, or explicitly names a tag command like `tag it as Cabo Trip`, `add tag Reimbursable`, `remove tag Tax`, `for Cabo Trip trip`.

- Do not infer tags from merchants, locations, categories, names, or words like hotel/trip unless explicitly requested.
- Use tag ids from `GET /api/tags`. If an explicitly requested tag is missing, create it first (`POST /api/tags` / `localfin_create_tag`), then pass its id in `tag_ids`.
- Default tag type is `custom`; use `trip`/`event`/`person`/`reimbursable`/`tax` only when user's wording matches those (`tagTypeSchema` in `shared/contracts/tags.ts`).
- Creation uses `hexColorSchema` from `shared/validation.ts` (`/^#[0-9a-fA-F]{6}$/`); pass nullable or omit.

## Search-before-update & bulk

- When user describes a transaction without an id, call `GET /api/transactions?searchQuery=` (or `localfin_search_transactions`) first, then `PUT /api/transactions/:id` / `localfin_update_transaction` with an id from results.
- Use `PUT /api/transactions/bulk` / `localfin_bulk_update_transactions` when user wants `all`/`every` matching transaction. Bulk preference over looping single updates.

## Dates, colors, validation

- Dates: `YYYY-MM-DD` only via `isIsoDate` (`shared/validation.ts:5`). Normalize `today` to `new Date().toISOString().slice(0,10)` in agent locale.
- Colors: `hexColorSchema` nullable; omit when not provided.
- Amounts: `finiteNumber` (Zod `z.number().finite()`); transaction amounts rounded to cents via `roundCurrencyAmount`.
- Subcategories: a subcategory with active transactions cannot be deleted (409); recategorize them first. Transfers/adjustments must have `subcategory_id: null`; income/expense may have null but flagged as uncategorized. `needsCategory` filters income/expense with null subcategory.
- Budget goals: `subcategories.monthly_goal` (>= 0 or null); the category summary prorates it by day over the requested range.
