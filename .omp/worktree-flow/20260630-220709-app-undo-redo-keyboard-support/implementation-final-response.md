Implemented and committed the approved plan.

- Commit: `3fe8c24707157239ce10f4f6a336c61073b79e92`
- Branch: `feature/app-undo-redo-keyboard-support`
- Worktree: `C:/Users/joesa/Code/localfin-ai-app-undo-redo-keyboard-support`
- Handoff written: `.omp/handoff/implementation-summary.md`
- `.omp/handoff/` remains untracked, per requirement.

Changed behavior:
- Added global app undo/redo keyboard commands:
  - Undo: `Ctrl+Z`, `Meta+Z`
  - Redo: `Ctrl+Shift+Z`, `Ctrl+Y`, `Shift+Meta+Z`
- Preserved native text-field undo/redo by keeping undo/redo shortcuts non-`inputSafe`.
- Converted shortcut defaults to plural bindings while keeping existing single custom override storage.
- Added restore backend/API support for transactions, accounts, categories, subcategories, and tags.
- Changed tag soft delete to retain `transaction_tags` associations for restore.
- Added global undo/redo provider and history stack behavior.
- Wired undoable finance/data-entry flows:
  - Transaction history edit/delete/bulk edit/bulk delete.
  - Transaction table paste/cut/clear batch edits.
  - Add Transactions draft transforms and save flow.
  - Tag creation from transaction entry.
  - Setup account/category/subcategory CRUD and reconcile adjustment.
  - TagManager create/update/delete.
- Left settings-local preferences, provider OAuth/sync/disconnect, and opaque AI chat mutations non-undoable.

Verification run:
- `npm run test:frontend` â€” passed, 22 tests.
- `npm test` â€” passed, 51 tests.
- `npm run typecheck` â€” passed.
- `npm run lint` â€” passed.

Skipped:
- Manual browser smoke test was not run. `data/budget.db` was absent when checked, so there was no prepared local dataset for the planâ€™s transaction-history/setup browser scenarios. Automated frontend/server tests, typecheck, and lint passed.

Final worktree status:
- No staged or unstaged implementation changes.
- Untracked workflow artifacts remain:
  - `.omp/handoff/`
  - `.omp/worktree-flow/20260630-220709-app-undo-redo-keyboard-support/`
