# Complex Transaction Search

## Summary

Add grep-like transaction search to the transaction history search bar and expose the same search capability to the assistant so it can find miscellaneous transactions before answering or updating them.

## Key Changes

- Create branch `feature/complex-transaction-search` from `main` in a plan-worktree checkout.
- Keep the existing `searchQuery` API parameter, but parse it as a safe query language with quoted phrases, parentheses, `AND`, `OR`, `NOT`, `|`, `-term`, text fields, and amount/date comparisons.
- Search across transaction name, comment, account, category, subcategory, amount, date, and type using parameterized SQLite predicates.
- Add an assistant `search_transactions` action and document the complex query syntax in the assistant tool/action definition.
- Keep the transaction history search bar compact, with a syntax hint placeholder and visible parse errors from the API.

## Test Plan

- Run parser tests for bare terms, quotes, operators, fields, comparisons, syntax errors, and unsafe-looking input.
- Run `npm run lint`.
- Run `npm run typecheck`.
- Manually smoke test the transaction history search bar and assistant search flow.

## Assumptions

- Grep-like means logical text filtering, not POSIX regex compatibility.
- The existing `searchQuery` parameter remains the public API surface.
- The assistant tool definition lives in `assistantSystemMessage()` until native tool calling is introduced.
