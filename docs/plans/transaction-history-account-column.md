# Transaction History Account Column

## Summary
Fix the transaction history table so `Account` is always visible immediately after `Date`, including the default unfiltered transaction list. This is a frontend table layout change; current backend query already returns `account_name`, `account_id`, and `account_color` through `getTransactionsWithDetails()`.

## Implementation Changes
1. Create implementation branch from `main`: `feature/transaction-history-account-column`.
2. In the implementation worktree, write this plan to `docs/plans/transaction-history-account-column.md`.
3. Update `src/components/features/TransactionTable.tsx`:
   - Move the `Account` header from after `Subcategory` to immediately after the `Date` header.
   - Move the account cell rendering to immediately after the date cell in each transaction row.
   - Keep the existing account display behavior: `<EntityLabel id={t.account_id} name={t.account_name} color={t.account_color} />`.
   - Do not make account sortable unless a separate requirement is added.
   - Keep the empty-state `colSpan` unchanged because the total column count does not change.
4. Verify the history page at `/transactions` in the default state and after applying filters to confirm the visible column order is:
   `select`, `Date`, `Account`, `Name`, `Amount`, `Balance`, `Category`, `Type`, `Subcategory`, `Actions`.

## Test Plan
- Run `npm run typecheck`.
- Run `npm run lint`.
- Run the app with `npm run dev` and visually verify the transaction history table in:
  - default date-range state,
  - account-filtered state,
  - search/filter-applied state,
  - inline edit mode for a row.

## Assumptions
- The intended fix is column placement and visibility, not adding account sorting.
- No backend/API change is needed because `/api/transactions` already uses `getTransactionsWithDetails()` for default and filtered requests.
- If implementation finds account values missing from the API response in the running app, investigate stale server/build state first, then add a focused backend regression test before changing query code.
