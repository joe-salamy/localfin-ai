Resolved merge conflicts in the integration worktree. No commit created.

Changed conflicted files:

- `src/components/features/MultiTransactionTable.tsx`
- `src/components/features/TagManager.tsx`
- `src/components/features/TransactionTable.tsx`
- `src/pages/SetupPage.tsx`
- `src/pages/TransactionHistoryPage.tsx`

Resolution decisions:

- Preserved latest `main` success-confirmation behavior by routing resolved success notifications through `useSuccessToast()`.
- Preserved audited feature undo/redo behavior by keeping `useUndoRedo()` action wrappers and restore/delete/update inverses.
- Preserved audited tag-picker create undo/redo callback behavior so created tag IDs are removed/re-added from controlled picker state on undo/redo.
- Kept provider sync/link/disconnect behavior from base unchanged.
- Removed all conflict markers.
- Staged the five resolved conflicted files with `git add`; `git diff --name-only --diff-filter=U` reports no unresolved files.

Wrote handoff summary:

- `.omp/handoff/conflict-resolution-summary.md`

Verification:

- `npm ci` â€” passed; installed missing locked dependencies because this integration worktree had no `node_modules`.
- `git diff --name-only --diff-filter=U` â€” passed; no unresolved files.
- `git diff --check` â€” passed; only emitted the existing LF-to-CRLF warning for the plan file.
- `git diff --cached --check` â€” passed; only emitted the existing LF-to-CRLF warning for the plan file.
- `npm run typecheck` â€” passed.
- `npm run test:frontend` â€” passed, 27 tests / 27 passed.
- `npm run lint` â€” passed.
- `npm test` â€” passed, 51 tests / 51 passed.

Skipped:

- Manual browser smoke test was not run.

Blockers:

- None.
