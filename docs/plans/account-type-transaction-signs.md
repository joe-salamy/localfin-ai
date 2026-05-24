# Fix Account-Type Transaction Sign Handling

## Summary

- Create branch `feature/account-type-transaction-signs` from `main`.
- Fix transaction input so stored `amount` is always an account-balance delta:
  - Asset/checking expense: negative.
  - Asset/checking income: positive.
  - Liability/credit-card expense: positive.
  - Liability/credit-card income/payment/refund: negative.
  - Transfers keep their provided direction.
- Include a guarded local database repair for existing rows, based on the current `data/budget.db` findings: `Visa CC` has many negative liability expenses, and `Discover CC` has many positive expense-category transactions stored as `kind='income'`.

## Key Changes

- Add a shared transaction-sign helper on the server that normalizes `amount` from `account.type` + `kind`; use it in `createTransaction` and `bulkCreateTransactions`.
- Update manual input/import behavior in `MultiTransactionTable`:
  - Default new rows to `expense`.
  - When account or kind changes, show the normalized account-delta sign for that account type.
  - Treat typed `+`/`-` as formatting input, not authoritative.
- Update statement parsing/categorization flow:
  - Fetch the selected account type before enriching parsed transactions.
  - Infer kind from category/AI result where available; otherwise default plain statement lines to `expense`.
  - Normalize the stored/displayed amount by account type and kind before duplicate checks and save payloads.
- Update AI categorization prompts/fallbacks so `kind` is not inferred solely from numeric sign for liability accounts. Expense classification should still use expense subcategories even when a credit-card charge stores as a positive account delta.

## Data Repair

- Add `scripts/repair-account-type-transaction-signs.ts` with `--dry-run` default and explicit `--apply`.
- Repair active, non-transfer transactions only; skip deleted rows and initial balances unless explicitly matched by category/kind rules.
- For liability accounts:
  - Expense-category or `kind='expense'` transactions become `kind='expense'` and positive `amount`.
  - Income-category or payment/refund `kind='income'` transactions become `kind='income'` and negative `amount`.
- For asset accounts:
  - Expense transactions become negative.
  - Income transactions become positive.
- Print account-level before/after counts and affected row IDs/names before applying.

## Public Interfaces

- Keep the existing API shape unchanged: `amount` remains a signed account delta, and `kind` remains `income | expense | transfer`.
- No schema migration is required.
- Add internal helper/types only; do not expose a new endpoint.

## Test Plan

- Add server transaction tests for create and bulk-create:
  - Checking expense `75` stores `-75`.
  - Checking income `75` stores `75`.
  - Credit-card expense `75` stores `75`.
  - Credit-card income/payment `75` stores `-75`.
  - Transfer amounts are not normalized.
- Add parser/categorization tests for credit-card statement charges: positive or negative pasted charge text both save as positive expense deltas on liability accounts.
- Add repair-script tests or a dry-run fixture test covering the current discovered patterns: Visa negative expenses and Discover positive expense-category rows with `kind='income'`.
- Run `npm test`, `npm run typecheck`, and `npm run lint`.

## Assumptions

- Credit cards are represented as `accounts.type='liability'`; checking is `accounts.type='asset'`.
- User-entered signs do not override account-type/kind normalization.
- Existing bad data should be repaired with an explicit script, not silently changed on app startup.
