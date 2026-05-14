# Dashboard And History Amount Gradients

## Summary

- Branch from `main`: `feature/dashboard-history-amount-gradients`.
- Worktree: `..\localfin-ai-dashboard-history-amount-gradients`.
- Change the amount-gradient feature to color amount text itself instead of row backgrounds.
- Apply local max scaling independently to dashboard account summaries, category summaries, dropdown detail rows, and the History page displayed transactions.

## Key Changes

- Refactor the display-settings gradient hook so callers can get a text color style from the existing settings and a caller-local max absolute amount.
- Preserve the settings UI, local storage shape, API contracts, and backend behavior.
- Remove row-background gradient application from transaction summary/history rows while keeping existing hover, selected, focused, and flagged backgrounds.

## Dashboard Behavior

- Account Summary:
  - Apply gradient text color to each account row's `total_change`.
  - Compute max from visible account `total_change` values only.
  - Keep starting balance, ending balance, badges, and net worth footer behavior unchanged.
- Account Summary Dropdowns:
  - Apply gradient text color to each transaction `amount`.
  - Compute max from that account's displayed transactions only.
- Category Summary:
  - Apply gradient text color to each category `difference`.
  - Compute max from visible non-null category differences only.
  - Keep totals, goals, badges, and null placeholders neutral.
- Category Summary Dropdowns:
  - Apply gradient text color to each subcategory `difference`.
  - Compute max from that category's visible non-null subcategory differences only.

## History Behavior

- Apply gradient text color to History page transaction `amount` values in `TransactionTable`.
- Compute max from the currently displayed `transactions` prop only.
- Recalculate whenever filters, sorting, pagination/display set, or data refresh changes the displayed transaction list.
- Keep transfer amounts muted and keep running balances neutral.

## Test Plan

- Run `npm run typecheck`.
- Run `npm run lint`.
- Manually verify with amount gradients enabled:
  - Dashboard account summary, category summary, account dropdowns, and category dropdowns each use independent local scales.
  - History page amount colors recalculate when displayed transactions change.
  - Disabled gradient setting falls back to current fixed red/green/muted text behavior.
