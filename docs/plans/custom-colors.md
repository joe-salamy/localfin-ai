# Custom Colors And Amount Gradients

## Summary
1. Create branch `feature/custom-colors` from `main`, using worktree `..\localfin-ai-custom-colors`.
2. Add persisted colors for accounts, categories, and subcategories, editable from the Setup page with about 20 preset swatches plus a native full color picker.
3. Add a localStorage-backed Settings control for transaction amount gradient coloring, enabled by toggle and customizable with negative/neutral/positive colors.

## Key Changes
- Add nullable `color TEXT` columns to `accounts`, `categories`, and `subcategories`; update schema plus idempotent startup migration using `PRAGMA table_info` and `ALTER TABLE`.
- Extend shared TS types and API create/update payloads with `color?: string | null`; validate colors server-side as `#RRGGBB`.
- Existing entities with no saved color get a deterministic fallback from a shared `DEFAULT_ENTITY_COLORS` palette based on stable id; new entities may receive a chosen color or fallback palette color.
- Allow color-only updates for system categories/subcategories while keeping their name/type/delete locks intact.
- Surface colors throughout displays:
  - Setup account/category/subcategory tables and edit/add forms.
  - Dashboard account and category summary rows, expanded transaction category labels.
  - Transaction history account/category/subcategory labels.
  - Net worth chart account lines and Sankey category/subcategory nodes.
  - Recent account transactions table and transaction input selects where entity names are shown.

## UI And Settings
- Add reusable `ColorPicker` component with preset swatches, current-color preview, and `<input type="color">`; keep it compact enough for Setup table rows and forms.
- In `SetupPage`, add a color column and color control to account/category/subcategory add and edit flows.
- Add a display preferences feature using localStorage key `localfin.display.v1`:
  - `amountGradientEnabled: boolean`, default `false`.
  - `negativeColor`, default red.
  - `neutralColor`, default white.
  - `positiveColor`, default green.
- In Settings, add a “Transaction Amount Colors” section with toggle, three color pickers, reset button, and a small sample row preview.
- Implement amount-row coloring as an opt-in background tint for all transaction tables: dashboard expanded account transactions and transaction history. Use the visible table’s min amount, zero, and max amount as the scale; interpolate negative-to-neutral and neutral-to-positive.

## Test Plan
- Run `npm run typecheck`.
- Run `npm run lint`.
- Run `npm test`.
- Manually verify:
  - Existing DB starts cleanly and existing entities render fallback colors.
  - Creating/editing accounts/categories/subcategories saves colors.
  - System category/subcategory color can change, but protected fields remain locked.
  - Dashboard, transaction history, charts, and recent account tables use selected entity colors.
  - Amount gradient toggle affects transaction rows only when enabled, and reset restores default colors.
  - Gradient remains readable for all-positive, all-negative, mixed, and zero-only tables.

## Assumptions
- Entity colors are persisted in SQLite because they are part of the financial taxonomy.
- Amount-gradient preferences are localStorage-only, matching the existing keyboard settings pattern.
- The gradient scale is per visible table, not global, so date filters and search results use their own visible min/max.
- The plan file path is `docs/plans/custom-colors.md`.
