# Transaction History Multi-Select Filters

## Summary
- Create `feature/transaction-history-multiselect-filters` from `main`.
- Use OR within each multi-select and AND across filter groups.
- Do not add an any/all toggle because a transaction has one account, one category, and one subcategory.

## Key Changes
- Add a reusable popover `MultiSelect` component with checkbox rows and a clear-all affordance.
- Replace the transaction history account dropdown with a multi-select.
- Add category and subcategory multi-select filters.
- Limit subcategory options to selected categories and remove incompatible selected subcategories.
- Preserve the existing explicit Apply behavior.

## API / Types
- Extend `TransactionFilters` with `accountIds?: string[]`, `categoryIds?: string[]`, and `subcategoryIds?: string[]`.
- Preserve existing `accountId` and `subcategoryId` compatibility.
- Serialize array filters as repeated query params.
- Validate repeated query params in the transaction route.
- Apply SQL `IN` filtering for selected accounts, categories, and subcategories.

## Test Plan
- Add backend service tests for OR within each filter group and AND across groups.
- Run `npm run typecheck`.
- Run `npm run lint`.
- Run `npm test`.

## Assumptions
- Category filtering excludes uncategorized and transfer transactions unless the existing `Needs Category` filter is used.
- The implementation happens in a separate worktree and does not touch `scratchpad.md`.
