# Logarithmic Amount Gradients

## Summary

- Branch from `main`: `feature/logarithmic-amount-gradients`.
- Plan file path: `docs/plans/logarithmic-amount-gradients.md`.
- Update the existing amount-gradient feature to use logarithmic scaling everywhere it is currently applied, so one very large amount no longer makes smaller non-zero amounts render nearly neutral.
- Do not add new category-summary gradient surfaces; keep the existing dashboard category `Difference` gradient behavior.

## Key Changes

- Replace the linear ratio in `amountGradientColor` with a logarithmic ratio:
  - Use `log1p(abs(amount)) / log1p(maxAbsAmount)` for non-zero values.
  - Preserve sign handling: negative values interpolate neutral-to-negative, positive values interpolate neutral-to-positive.
  - Preserve zero behavior: zero returns the neutral color.
  - Clamp the ratio to `[0, 1]` before mixing colors.
- Keep `useAmountGradient(amounts)` as the shared API so all current callers inherit the new scale:
  - Transaction history amount text.
  - Dashboard account summary `Change`.
  - Dashboard account expanded transaction amounts.
  - Dashboard category summary `Difference`.
  - Dashboard category expanded subcategory `Difference`.
- Preserve existing settings, localStorage shape, toggle behavior, color pickers, and disabled-gradient fallback styling.

## Test Plan

- Add focused unit coverage for the color helper if the project has a suitable frontend test pattern; otherwise keep verification to type/lint plus manual checks.
- Run `npm run typecheck`.
- Run `npm run lint`.
- Manually verify with amount gradients enabled:
  - A data set such as `[-10000, -1000, -100, -10, 0, 10, 100, 1000, 10000]` shows visible tonal differences across orders of magnitude.
  - Transaction history no longer makes smaller transactions look white when one transaction is much larger.
  - Dashboard account and category summary gradients still use their existing local scales.
  - Turning the setting off restores the existing fixed red/green/muted text colors.

## Assumptions

- "Apply the log scale to all" means every current use of `useAmountGradient`, not only transaction history.
- Category summary remains limited to the existing `Difference` column behavior already present in the codebase.
- No API, database, or stored settings migration is needed because this only changes client-side color interpolation.
