Implemented and committed the approved plan.

Commit:
- `e62fbccc8f3689718e6157c6151fc2b9725cd2eb` â€” `Implement plan`

Changed files committed:
- `src/features/spreadsheet-selection/selection.ts`
- `src/features/spreadsheet-selection/selection.test.ts`
- `src/features/spreadsheet-selection/domTargets.ts`
- `src/features/spreadsheet-selection/domTargets.test.ts`
- `src/components/features/MultiTransactionTable.tsx`
- `src/components/features/TransactionTable.tsx`

Behavior delivered:
- Shared range helpers: range expansion, top-left cell, scalar clipboard detection, bounded arrow movement.
- Shared DOM target guards for native editable targets and selected input text.
- Add Transactions:
  - Scalar fill over selected cells.
  - Delete/Backspace clears selected cells.
  - Copy-only dashed copied-range indicator with timeout/cleanup.
  - Escape clears selection/copied state or exits edit mode.
  - Arrow navigation and Shift+Arrow range extension.
  - Enter/F2 edit mode while preserving Ctrl/Cmd+Enter Save All.
  - Updated helper text.
- Transaction History:
  - Scalar fill through `onEditMany` with `Fill transaction cells`.
  - Delete/Backspace clearing through existing clear path.
  - Copied-range indicator lifecycle.
  - Escape and arrow navigation outside row edit mode.
  - Programmatic focus guard so navigation focus does not collapse Shift+Arrow selections.

Verification run:
- `npm run test:frontend` â€” passed, 48 tests.
- `npm run typecheck` â€” passed.
- `npm run lint` â€” passed.
- Manual Add Transactions browser QA on worktree client `http://localhost:5174/transactions/input`:
  - Shift+ArrowDown selected two Name cells.
  - Scalar paste `Coffee` filled both selected Name cells.
  - Backspace cleared both selected Name cells.
  - ArrowRight moved active cell from Date to Name.
  - Copy showed dashed primary copied-range outline and it faded after timeout.

Skipped/partial:
- Manual Transaction History browser QA was not completed. The worktree client had to run on `5174` because `5173` was already occupied; server POSTs rejected origin `http://localhost:5174` with `403 {"success":false,"error":"Origin not allowed by CORS"}` while trying to create QA transactions. The worktree History view had no visible transactions to exercise persisted scalar fill/delete manually.

Handoff written:
- `.omp/handoff/implementation-summary.md`

Final status:
- Implementation changes are committed.
- `.omp/handoff/` and `.omp/worktree-flow/.../` remain untracked workflow artifacts, as required.
