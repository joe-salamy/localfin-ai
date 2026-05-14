# Transfer Kind Implementation Plan

## Summary
- Create branch `feature/transaction-transfer-kind` from `main`, with implementation in worktree `..\localfin-ai-transaction-transfer-kind`.
- Add a durable transaction kind: `income | expense | transfer`. Transfers remain two separate transactions, keep affecting account balances/net worth, but are excluded from spending/income/budget flow reports.
- Do not auto-backfill existing uncategorized transactions as transfers. Existing rows default to `income` or `expense` by amount sign and can be manually changed later.

## Key Changes
- Add `kind TEXT NOT NULL DEFAULT ... CHECK(kind IN ('income','expense','transfer'))` to `transactions`, plus startup migration in `server/db/index.ts`.
  - Existing rows initialize as `income` for `amount >= 0`, `expense` for `amount < 0`.
  - New/updated transfer rows must persist `subcategory_id = NULL`.
  - Income/expense rows may still have `subcategory_id = NULL` so true uncategorized spending remains possible.
- Update shared types/API validation so create, update, bulk create, bulk update, filters, and table rows expose `kind`.
  - Default omitted `kind` at create time from amount sign.
  - Add transaction filters for `kind` and `needsCategory`, where `needsCategory` means `kind IN ('income','expense') AND subcategory_id IS NULL`.
- Update dashboard/reporting queries:
  - Account balances, running balances, recent activity, and net worth include all transactions.
  - Dashboard income/expense metrics, category summary, spending goals, and Sankey use only `kind = 'income'` or `kind = 'expense'` as appropriate, never `transfer`.
  - Category summaries should not show transfer rows under unassigned categories.

## Lookup, AI, And Import Behavior
- Update `/api/ai/categorize` request/response to include `kind`.
  - Lookup first reuses prior same-account normalized-name results, including `transfer`.
  - Deterministic transfer detection marks `kind = 'transfer'` when either:
    - an opposite-signed same-amount transaction exists in another account within +/- 3 days, or
    - the cleaned name strongly matches transfer/payment patterns such as `transfer`, `online transfer`, `credit card payment`, `payment thank you`, `autopay`, `ACH payment`.
  - AI fallback returns numeric indexes for both `kind` and subcategory:
    - `kind` index choices are fixed in the prompt as `0 = income`, `1 = expense`, `2 = transfer`.
    - `subcategory` remains the numbered available-subcategory index.
    - Expected JSON shape: `{ "results": [{ "index": 0, "kind": 2, "subcategory": null }] }`.
    - If the model uses one-based indexes for result `index`, keep the existing compatibility normalization. Do not allow one-based `kind`; only `0`, `1`, or `2` are valid.
    - If `kind = transfer`, ignore subcategory and return `subcategory_id = null`.
    - If `kind = income` or `expense`, enforce category type matching and fall back to the matching Unassigned subcategory.
- Update statement parsing so parsed statement rows go through the same lookup/deterministic/AI categorization path before reaching the bulk input table.
- Update past examples in AI prompts to include transfer examples and teach the model that transfers have no category and are excluded from budget reports.
- Keep duplicate detection unchanged except for accepting/preserving `kind` in import rows.

## UI Behavior
- In bulk transaction input, add a compact `Type` dropdown with `Income`, `Expense`, `Transfer`.
  - Default from amount sign unless categorization/import sets it.
  - When `Transfer` is selected, clear and disable subcategory.
  - Show categorization source as today, with `transfer` shown clearly when detected.
- In transaction history, add/edit the `Type` field.
  - Add filters for `All / Income / Expense / Transfer / Needs category`.
  - `Needs category` must exclude transfers.
  - Bulk edit should support changing selected transactions to transfer, clearing subcategory.
- Display transfer rows with neutral styling rather than income/expense budget semantics.

## Test Plan
- Add/update server tests for schema migration defaults, create/update/bulk create transfer behavior, null subcategory enforcement, and `needsCategory` filtering.
- Add AI service tests for same-name lookup returning transfer, opposite-amount/date transfer detection, pattern-based transfer detection, numeric kind-index parsing, invalid kind-index fallback, and AI fallback resolving `kind`.
- Add parser tests showing pasted statement lines can return `transfer` before save.
- Add dashboard/chart/goal tests proving transfers affect balances/net worth but not income, expense, category totals, Sankey, or spending progress.
- Run `npm run test`, `npm run typecheck`, and `npm run lint` in the worktree.

## Assumptions
- Column name will be `kind` in code and SQLite for readability.
- No automatic backfill of old uncategorized transfers beyond initializing old rows from amount sign.
- Transfer detection should be “pattern plus match”: deterministic rules can mark new rows as transfer before AI, and AI remains the fallback for ambiguous rows.
- AI kind choices are fixed zero-based indexes: `0 = income`, `1 = expense`, `2 = transfer`.
