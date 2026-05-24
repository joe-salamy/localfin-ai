# Update Account Current Value

## Summary

- Create branch `feature/update-account-current-value` from `main` in a new plan worktree.
- Add a first-class `adjustment` transaction kind for balance/value reconciliations.
- Add a Setup Accounts action that lets the user enter a target account value and date; the server creates one delta transaction to bring the account balance to that value.

## Key Changes

- API/type contract:
  - Extend `TransactionKind` to `'income' | 'expense' | 'transfer' | 'adjustment'`.
  - Add `POST /api/accounts/:id/reconcile` with body `{ date: "YYYY-MM-DD", target_balance: number, name?: string }`.
  - Response: `{ transaction: Transaction | null, previous_balance: number, target_balance: number, adjustment_amount: number }`.
  - If the rounded cent delta is `0`, return `transaction: null` and do not create a row.
- Backend behavior:
  - Calculate `previous_balance` as the sum of non-deleted transactions for the account with `date <= requested date`.
  - Create one transaction with `kind = "adjustment"`, `subcategory_id = null`, and `amount = target_balance - previous_balance`.
  - Default generated names:
    - Asset positive delta: `Appreciation`
    - Asset negative delta: `Depreciation`
    - Liability positive delta: `Balance Increase`
    - Liability negative delta: `Balance Decrease`
  - Rebuild/migrate the SQLite `transactions.kind` check constraint so existing databases accept `adjustment`.
  - Treat `adjustment` like `transfer` for category rules: no subcategory, not returned by `needsCategory`, and excluded from income/expense category summaries, Sankey, and income/expense metrics while still affecting balances and net worth.
- Frontend behavior:
  - Add `useAccounts().reconcileAccount` mutation and invalidate accounts, transactions, and dashboard queries on success.
  - In `SetupPage` Accounts table, add an icon action next to each account that opens a modal with current balance, target value, date defaulting to today, computed delta preview, and optional generated name display.
  - After save, show a toast with the adjustment amount or "already matched" when no transaction was needed.
  - Update transaction history/editing UI to display and preserve `adjustment`; disable subcategory selection for both `transfer` and `adjustment`.

## Test Plan

- Add server tests for:
  - Creating positive and negative asset adjustments.
  - Including same-period deposits/withdrawals already entered before the reconcile date.
  - Backdated reconciliation using balance as of the chosen date.
  - Zero-delta no-op response.
  - Missing/deleted account validation.
  - Existing DB migration from the old `income|expense|transfer` constraint to include `adjustment`.
- Update existing transaction tests for:
  - `adjustment` cannot retain a subcategory.
  - `needsCategory` excludes `adjustment`.
  - Dashboard metrics/category/Sankey exclude `adjustment`, while account balances/net worth include it.
- Run `npm run test`, `npm run typecheck`, and `npm run lint`.

## Assumptions

- Reconciliation applies to all account types, not only investment accounts.
- The target value is an as-of-date balance, defaulting to today in the UI.
- Adjustments are transaction-derived so no separate mutable account balance field is added.
- The implementation will happen in an isolated worktree via the `plan-worktree` workflow and will be committed on the feature branch, not merged into `main`.
