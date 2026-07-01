Implemented and committed the approved reset-column-widths plan.

Changed files:
- `src/features/table-layout/storage.ts`
  - Added `resetAllTableColumnWidths()`.
  - Added `subscribeToTableColumnWidthReset(listener)`.
  - Added optional `removeItem` support while keeping storage shims valid with only `getItem`/`setItem`.
- `src/features/table-layout/useResizableColumns.ts`
  - Mounted resizable tables now refresh widths on global reset and table ID changes.
- `src/pages/SettingsPage.tsx`
  - Added Settings > Interface reset control:
    - `Table column widths`
    - `Reset Column Widths`
    - Confirmation: `Column widths reset to defaults.`
- `src/features/table-layout/storage.test.ts`
  - Added reset/removal/subscriber/fallback/unavailable-storage coverage.

Commit:
- `8bfa9d8cf2795ea3564f270c6c1baae503dcc434` (`Implement plan`)

Verification:
- `node --import tsx --test src/features/table-layout/storage.test.ts`
  - First attempt failed because this worktree had no installed dependencies: missing `tsx`.
  - Ran `npm ci`.
  - Re-run passed: 7/7 tests.
- `npm run test:frontend`
  - Passed: 31/31 tests.
- `npm run typecheck`
  - Passed.
- `npm run lint`
  - Passed.
- Browser smoke against `npm run dev:client` at `/settings`
  - Seeded `settings.shortcuts` persisted widths.
  - Verified pre-reset widths: `400px`, `160px`, `150px`, `190px`, `130px`.
  - Clicked `Reset Column Widths`.
  - Verified message visible.
  - Verified storage key removed: `localStorage.getItem("localfin.table-column-widths.v1") === null`.
  - Verified mounted table reset without reload to defaults: `320px`, `140px`, `140px`, `180px`, `128px`.

Handoff:
- Wrote `.omp/handoff/implementation-summary.md`.
- Left `.omp/handoff/` uncommitted as required.
- Final status has no staged/unstaged implementation changes; only workflow artifacts remain untracked:
  - `.omp/handoff/`
  - `.omp/worktree-flow/20260701-111122-reset-column-widths/`

Known risk:
- If a future reset subscriber throws, later subscribers would not run. Current subscribers are React state refresh callbacks and are not expected to throw.
