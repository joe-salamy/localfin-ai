# Spotify-Inspired LocalFin Design System Update

## Summary
- Create feature branch `feature/spotify-inspired-design-system` from `main`.
- Use `DESIGN.md` plus the approved concept at `C:\Users\joesa\.codex\generated_images\019e0619-f103-7613-a054-1c572243c6ae\ig_02f43e79c0e05c770169fd780a6a848199b5447c1e4fe95990.png` as the visual target.
- Update the entire React/Tailwind frontend design system while preserving current routes, data behavior, keyboard shortcuts, and backend APIs.

## Key Changes
- Replace global theme tokens in `src/index.css` with Spotify-inspired LocalFin tokens: near-black base, charcoal surfaces, white/silver text, functional green accent, semantic finance/error/warning/info colors, pill radii, dense spacing, and heavy dark elevation shadows.
- Standardize UI primitives: `Button`, `Card`, `Input`, `Modal`, `SimpleSelect`, `EntityLabel`, color controls, shortcut hints, checkboxes, icon buttons, and focus states.
- Rework the app shell into a dense product layout: dark sidebar-first navigation on desktop, compact mobile navigation, constrained main workspace, and assistant entry/control styling consistent with circular/pill geometry.
- Restyle all major screens: dashboard metrics/charts/tables, add-transaction workflow, transaction history filters/table/bulk actions, setup accordions/forms/tables, settings panels, modals, empty/loading/error states, and the AI assistant panel.
- Keep green functional only: active navigation, primary CTAs, successful/positive affordances. Keep finance category/account colors as small content accents only.

## Interfaces
- No backend API, database, route, or hook contract changes.
- Tailwind theme token names should remain compatible where possible (`background`, `foreground`, `card`, `border`, `input`, `primary`, `secondary`, `muted`, `ring`, `income`, `expense`) to limit churn.
- Button variants should remain source-compatible (`primary`, `secondary`, `ghost`, `destructive`; `sm`, `md`, `lg`) but change visual output to pills, uppercase/tracked labels, and Spotify-like states.
- Add shared CSS utility classes only when they reduce repeated dense table/input/button styling; do not introduce a new styling framework.

## Test Plan
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Start `npm run dev` and visually verify desktop and mobile layouts for Dashboard, Setup, Add Transactions, Transaction History, Settings, modals, and AI assistant.
- Use Playwright or browser screenshots to compare against the approved concept for palette, density, sidebar shell, pill controls, card/table styling, typography, and responsive behavior.
- Check keyboard shortcut hints, focus rings, table editing, bulk actions, statement import, assistant open/send/close, and modal confirm/cancel flows still work.

## Assumptions
- The redesign is frontend-only.
- The app should feel Spotify-inspired, not Spotify-branded: no Spotify logo, music metaphors, playlist UI, or album-art dependency.
- Current LocalFin information architecture stays intact.
- Use system font fallbacks approximating SpotifyMix/Circular rather than bundling proprietary fonts.
- `scratchpad.md` remains untouched and excluded from all reads, writes, and diffs.
