# Fix Dashboard Sankey Diagram

## Summary

Fix the dashboard Sankey as an all-detail, responsive chart: keep every subcategory node, prevent label clipping, improve link visibility, and make the chart scale inside the card without horizontal overflow.

## Key Changes

- Update `SankeyDiagram` to compute responsive chart height and margins from container width plus node count.
- Keep all nodes and links, but render labels with safe truncation and full names available in browser-native SVG titles/tooltips.
- Increase link contrast on the dark card with stronger base and hover opacity.
- Reduce visual crowding by tuning `nodeSpacing`, `nodeThickness`, margins, and height instead of aggregating subcategories.
- Update Sankey data preparation so subcategory nodes use clean `displayName` values like `Rent`, while retaining unique internal ids such as `Rent (expense)` where needed.
- Add custom node/link tooltips showing full labels and formatted dollar values.

## Interfaces

- No endpoint route changes.
- Keep existing `SankeyData`, `SankeyNode`, and `SankeyLink` shape.
- Use the existing optional `displayName` field more consistently for income and expense subcategory labels.

## Test Plan

- Add or update server tests for `prepareSankeyData` to verify:
  - subcategory node ids remain unique across income/expense,
  - `displayName` omits internal suffixes,
  - all subcategory links are preserved.
- Run `npm run typecheck`.
- Run `npm run lint`.
- Run `npm test`.
- Start the app and visually verify the dashboard Sankey at desktop and narrow widths:
  - no clipped right-side labels,
  - all subcategory nodes remain present,
  - links are visible on the dark background,
  - no horizontal page overflow.

## Assumptions

- The desired behavior is all-detail Sankey data, not category-only and not grouped long-tail categories.
- Responsive fit means the card may become taller, but it should not require horizontal scrolling.
- Full long labels may be truncated visually when space is tight, as long as full names and values are available in tooltips/titles.
