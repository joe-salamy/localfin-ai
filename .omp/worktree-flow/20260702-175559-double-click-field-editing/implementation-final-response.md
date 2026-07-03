Implemented and committed the approved plan.

Decision:
- Added shared guarded double-click edit entry for pencil-edit field paths only.
- Reused existing local `startEdit(...)` flows; no new edit state, no shortcut dispatch, no generic `Button` changes.
- Preserved protected/system/non-editable surfaces.

Changed files committed:
- `src/lib/fieldEditDoubleClick.ts`
- `src/lib/fieldEditDoubleClick.test.ts`
- `src/components/features/TransactionTable.tsx`
- `src/pages/SetupPage.tsx`
- `src/components/features/TagManager.tsx`

Commit:
- `e6930b5a0e936818815ae619da6622a65d961385`
- Message: `Implement plan`

Handoff:
- Wrote `.omp/handoff/implementation-summary.md`
- Left `.omp/handoff/` untracked as required.
- Final status: only workflow artifacts untracked:
  - `.omp/handoff/`
  - `.omp/worktree-flow/20260702-175559-double-click-field-editing/`

Verification run:
- `npm install`
  - Installed missing local dependencies required to run project scripts.
- `node --import tsx --test src/lib/fieldEditDoubleClick.test.ts`
  - Pass: 5/5.
- `npm run test:frontend`
  - Pass: 44/44.
- `npm run typecheck`
  - Pass after fixing the new testâ€™s `TS1294` parameter-property issue under `erasableSyntaxOnly`.
- `npm run lint`
  - Pass.
- Browser smoke against worktree client on `http://127.0.0.1:5174` with backend on `3001`:
  - `/setup`: account name double-click opened edit.
  - `/setup`: account checkbox double-click did not open edit.
  - `/setup`: editable category name double-click opened edit.
  - `/setup`: system category name double-click did not open edit.
  - `/setup`: editable subcategory name double-click opened edit.
  - `/settings`: temporary tag fixture double-click opened tag edit; fixture deleted.
  - `/transactions/history`: temporary transaction fixture date double-click opened edit; account cell double-click did not open edit; fixtures deleted.

Skipped:
- Full exhaustive manual click-through of every listed cell. The smoke covered representative editable/protected paths in each affected area; typecheck/lint covered the repeated same-handler wiring.
