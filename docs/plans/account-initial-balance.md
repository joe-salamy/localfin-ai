# Account Initial Balance Field

## Summary

- First implementation step: create `feature/account-initial-balance` from `main` in a separate worktree, using path `..\localfin-ai-account-initial-balance`.
- Replace the current "initial balance as transaction" workaround with a mutable `accounts.initial_balance` field.
- Migrate existing active initial-balance transactions into that field and hard-delete the absorbed transaction rows.

## Key Changes

- Add `initial_balance REAL NOT NULL DEFAULT 0` to `accounts` in `server/db/schema.sql` and `server/db/index.ts` migration logic.
- Migration behavior:
  - Match active transactions where `is_initial_balance = 1` or `lower(trim(name)) = 'initial balance'`.
  - Sum matched rows per account and add the sum to `accounts.initial_balance`.
  - Hard-delete those matched transaction rows from `transactions`.
  - Run the absorb/delete step inside a DB transaction so repeated startup remains safe.
- Update account APIs/types:
  - `Account` and `AccountWithBalance` include `initial_balance`.
  - `CreateAccountData` and account route schemas keep `initial_balance`.
  - `updateAccount` and `PUT /api/accounts/:id` accept mutable `initial_balance`.
  - `createAccount` stores `initial_balance` directly on the account and no longer creates an "Initial Balance" transaction.
- Update balance calculations:
  - `current_balance = accounts.initial_balance + sum(active transactions)`.
  - Dashboard account starting/ending balances include the account baseline.
  - Transaction running balances include the account baseline.
  - Net worth summary and net worth chart include the account baseline at every date.
  - Category, Sankey, income, and expense summaries continue to use only real transactions.
- Update UI:
  - Setup > Accounts table shows both `Initial Balance` and computed `Balance`.
  - Account add form keeps the initial balance input.
  - Account edit row adds an editable initial balance number input and saves it through `updateAccount`.
  - Sorting by balance continues to sort on computed current balance.

## Test Plan

- Add focused server tests for account creation/update:
  - Creating an account with `initial_balance` stores it on the account and creates no transaction.
  - Updating `initial_balance` changes returned account data and computed current balance.
- Add migration test coverage:
  - Existing named `Initial Balance` rows and flagged rows are absorbed into `accounts.initial_balance`.
  - Multiple matched rows for one account are summed.
  - Absorbed rows are hard-deleted.
  - Deleted transactions are not absorbed.
- Update existing balance-related tests:
  - Recent activity current balance includes initial balance for accounts with and without later transactions.
  - Transaction running balances include account initial balance.
  - Net worth chart includes initial balance without relying on an initial-balance transaction.
- Run `npm run test`, `npm run typecheck`, and `npm run lint`.

## Assumptions

- Historical balances use the account initial balance as an always-present baseline, independent of date.
- Cleanup absorbs active rows matched by either `is_initial_balance = 1` or the case-insensitive exact name `Initial Balance`.
- Cleanup physically removes absorbed transaction rows from the database, rather than soft-deleting them.
