# Add Account Latest Transactions Table

1. Create branch `feature/add-account-latest-transactions-table` from `main` in a separate worktree.
2. Reuse the existing recent-activity transaction endpoint if it can supply one row per active account.
3. Ensure the backend selects a deterministic most recent transaction per account and exposes the account current balance as that transaction's running balance.
4. Add a compact table to the Add Transactions page that displays account, latest transaction date/name/amount, and current balance.
5. Verify with `npm run lint` and `npm run typecheck`, then commit the worktree branch.
