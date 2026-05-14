# Absolute Amount Transaction Gradient

## Summary

Implement in isolated worktree branch `feature/absolute-amount-gradient` from `main`, with worktree path `..\localfin-ai-absolute-amount-gradient`.

Change the transaction amount color toggle so row color intensity is based on the largest absolute transaction amount in the currently displayed set, not separate positive and negative ranges.

## Key Changes

- Update the amount gradient utility in `src/lib/colors.ts` to use a single `maxAbsAmount` scale:
  - `0` or no nonzero displayed amounts returns the neutral color.
  - Negative amounts interpolate from neutral to configured negative color using `abs(amount) / maxAbsAmount`.
  - Positive amounts interpolate from neutral to configured positive color using `amount / maxAbsAmount`.
  - Clamp ratios to `0..1` through the existing `mixHexColors` behavior.
- Update `useAmountGradient` in `src/features/display-settings/hooks.ts`:
  - Compute `maxAbsAmount` from the `amounts` array passed by each displayed table/list.
  - Pass that single scale value to `amountGradientColor`.
  - Preserve the existing toggle behavior and row background alpha suffix (`24`) so the UI style stays consistent.
- Preserve current per-view relativity:
  - Main transaction table scales against the currently rendered `transactions`.
  - Latest transactions by account scales against currently rendered latest-transaction rows.
  - Expanded account transaction lists scale against that account's displayed transactions.

## Test Plan

- Run `npm run typecheck`.
- Run `npm run lint`.
- Manually verify with the amount color toggle enabled:
  - `[-1000, 50]` renders `-1000` at full negative intensity and `50` as light positive.
  - `[-10, 1000]` renders `1000` at full positive intensity and `-10` as light negative.
  - Equal magnitudes like `[-500, 500]` render both signs at full endpoint intensity.
  - All-zero or empty displayed sets render neutral/no meaningful tint and do not error.
  - Filtering/sorting displayed transactions recomputes the scale from the displayed rows.

## Assumptions

- "Max darkness" means the existing configured endpoint color at the existing row alpha, not making rows fully opaque.
- No backend, database, API, or persisted settings changes are needed.
- No new frontend test framework should be introduced for this small UI logic change.
