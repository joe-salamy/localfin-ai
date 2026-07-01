# App Undo Redo Keyboard Support Implementation Summary

## Plan

- Plan path: `.omp/worktree-flow/20260630-220709-app-undo-redo-keyboard-support/plan.md`

## Worktree

- Worktree path: `C:/Users/joesa/Code/localfin-ai-app-undo-redo-keyboard-support`
- Branch: `feature/app-undo-redo-keyboard-support`
- Commit: `3fe8c24707157239ce10f4f6a336c61073b79e92`
- Commit message: `Implement plan`

## Changed files

- `server/core-invariants.test.ts`
- `server/routes/accounts.ts`
- `server/routes/categories.ts`
- `server/routes/tags.ts`
- `server/routes/transactions.ts`
- `server/services/accounts.ts`
- `server/services/categories.ts`
- `server/services/tags.ts`
- `server/services/transactions.ts`
- `src/App.tsx`
- `src/components/features/MultiTransactionTable.tsx`
- `src/components/features/TagManager.tsx`
- `src/components/features/TransactionTable.tsx`
- `src/features/shortcuts/ShortcutContext.ts`
- `src/features/shortcuts/ShortcutHint.tsx`
- `src/features/shortcuts/ShortcutProvider.tsx`
- `src/features/shortcuts/commands.test.ts`
- `src/features/shortcuts/commands.ts`
- `src/features/shortcuts/hooks.ts`
- `src/features/shortcuts/normalize.test.ts`
- `src/features/shortcuts/normalize.ts`
- `src/features/undo-redo/UndoRedoContext.ts`
- `src/features/undo-redo/UndoRedoProvider.tsx`
- `src/features/undo-redo/financeSnapshots.ts`
- `src/features/undo-redo/history.test.ts`
- `src/features/undo-redo/history.ts`
- `src/features/undo-redo/hooks.ts`
- `src/features/undo-redo/index.ts`
- `src/hooks/useAccounts.ts`
- `src/hooks/useCategories.ts`
- `src/hooks/useTags.ts`
- `src/hooks/useTransactions.ts`
- `src/pages/SettingsPage.tsx`
- `src/pages/SetupPage.tsx`
- `src/pages/TransactionHistoryPage.tsx`

## Behavior changes

### Shortcut registry

- Added global undo and redo commands:
  - `global.undo`: defaults `Ctrl+Z` and `Meta+Z`.
  - `global.redo`: defaults `Ctrl+Shift+Z`, `Ctrl+Y`, and `Shift+Meta+Z`.
- Replaced one default binding per command with plural `defaultBindings` while preserving one custom override per command in existing `localfin.shortcuts.v1` storage.
- Added effective-binding list helpers:
  - `getShortcuts(commandId)` returns all effective bindings.
  - `getShortcut(commandId)` remains a compatibility helper returning the first effective binding or `null`.
  - `displayShortcutList()` joins labels with ` / `.
  - `ariaKeyShortcutList()` joins ARIA shortcut tokens with spaces.
- Shortcut dispatch now matches any effective binding for a command.
- Conflict checks now compare all candidate effective bindings across overlapping scopes.
- Editable-target filtering remains intact: undo/redo commands are not `inputSafe`, so native text-field undo/redo is preserved inside `input`, `textarea`, `select`, and `contenteditable` targets.

### Restore-capable API and hooks

- Added restore service functions and POST routes for:
  - `POST /api/transactions/:id/restore`
  - `POST /api/transactions/bulk/restore`
  - `POST /api/accounts/:id/restore`
  - `POST /api/categories/:id/restore`
  - `POST /api/subcategories/:id/restore`
  - `POST /api/tags/:id/restore`
- Transaction restore validates active account and, when present, active subcategory/category dependencies. Bulk transaction restore runs in one database transaction and returns rows in request order.
- Account/category/subcategory/tag restore validates same-key active conflicts and keeps the deleted row deleted when conflict validation fails.
- `deleteTag()` now soft-deletes tags without deleting `transaction_tags` rows, so tag associations are hidden while deleted and visible again after restore.
- Added frontend restore mutations with the same invalidation groups as related create/delete mutations:
  - `restoreTransaction`, `bulkRestoreTransactions`
  - `restoreAccount`
  - `restoreCategory`, `restoreSubcategory`
  - `restoreTag`

### Undo/redo provider

- Added `src/features/undo-redo` with the planned public API:
  - `UndoableAction`
  - `UndoRedoContextValue`
  - `UndoRedoProvider`
  - `useUndoRedo()`
- `execute()` runs `apply()`, pushes to undo history only after success, clears redo history, and returns `false` without running while another action is running.
- `undo()` and `redo()` move actions between stacks only after successful inverse/reapply operations.
- Failed apply/undo/redo operations leave both stacks unchanged and reset `isRunning`.
- Keyboard-triggered undo/redo emits only failure toasts: `Failed to undo {label}.` and `Failed to redo {label}.` No success/no-op toasts were added.
- Mounted `UndoRedoProvider` inside `ShortcutProvider` and outside the existing routed display/flagged-word providers.

### Transaction history

- Added `transactionSnapshotToUpdate()` to capture restorable transaction edit fields: `date`, `name`, `amount`, `kind`, `subcategory_id`, `comment`, `tag_ids`, and `ai_suggested`.
- Made transaction history edit/delete/bulk edit/bulk delete undoable when the current visible transaction snapshots are available.
- Missing current snapshots fall back to the existing non-undoable mutation path instead of fetching hidden rows.
- Added `TransactionTable.onEditMany()` and wired subcategory paste, history clipboard matrix paste, selected-cell clear, and cut-to-clear flows into one undoable action per batch.
- Undo restores persisted data only; selection/modal/focus/sort/filter/scroll restoration was not added.

### Add transactions

- Wrapped local draft transformations as undoable draft actions: add row, remove row, clear all, grid paste, grid cut/clear, AI categorization application, parse-statement application, and duplicate-marking row updates when rows change.
- Per-keystroke row editing remains native and is not wrapped.
- Wrapped save flow as one undoable persisted action:
  - Initial apply performs duplicate checks and bulk create as before.
  - Undo bulk-deletes created ids.
  - Redo bulk-restores the same ids.
- Wrapped tag creation from the transaction input tag picker as undoable create/delete/restore.

### Setup and tag management

- Made setup account create/update/color/delete/bulk delete undoable.
- Made reconcile adjustment undoable only when reconciliation creates a transaction; undo deletes the adjustment and redo restores it.
- Provider OAuth start, provider sync, and provider disconnect remain non-undoable.
- Made category and subcategory create/update/color/delete/bulk delete undoable while preserving system-entity protections.
- Made `TagManager` tag create/update/delete undoable through delete/restore/update inverses.
- Settings-local actions such as shortcut preferences and flagged-word preferences remain non-undoable.

## Tests and checks run

- `npm run test:frontend`
  - Result: passed.
  - Observed: 22 tests, 22 passed, 0 failed.
- `npm test`
  - Result: passed.
  - Observed: 51 tests, 51 passed, 0 failed.
- `npm run typecheck`
  - Result: passed.
- `npm run lint`
  - Result: passed.

## New test coverage

- `src/features/shortcuts/normalize.test.ts`
  - Exact normalized shortcut keys for undo/redo aliases.
  - `parseShortcut("Cmd+Shift+Z")` normalizes to `Shift+Meta+Z`.
- `src/features/shortcuts/commands.test.ts`
  - `global.undo` default aliases.
  - `global.redo` default aliases.
  - Unique command ids.
- `src/features/undo-redo/history.test.ts`
  - Execute pushes undo and clears redo.
  - Undo moves the newest undo action to redo without mutating prior snapshots.
  - Redo moves the newest redo action back to undo.
  - Failed execute/undo/redo attempts leave stacks unchanged.
- `server/core-invariants.test.ts`
  - Transaction restore preserves transaction id and retained tag associations.
  - Bulk restore preserves ids and caller-requested order.
  - Account/category/subcategory/tag restore preserves ids.
  - Tag restore makes retained transaction tag associations visible again.
  - Same-key restore conflicts throw and leave deleted rows deleted.

## Skipped checks

- Manual browser smoke test from the plan was not run. The worktree had no existing `data/budget.db` (`data/budget.db` was absent when checked), so there was no prepared local browser dataset for transaction-history/setup smoke scenarios. The implemented behavior is covered by focused frontend/server tests plus full typecheck and lint.
- No dev-server E2E was run.

## Implementation decisions and tradeoffs

- Shortcut storage key/version remains `localfin.shortcuts.v1`; plural defaults are derived from command definitions and are not persisted. This avoids a migration and keeps existing single custom overrides valid.
- `getShortcut()` remains for existing consumers, but UI surfaces that can represent aliases now use list helpers.
- Restore endpoints use soft-restore with conflict checks instead of renaming restored entities. This matches the plan and avoids surprising finance data changes.
- Tag soft delete retains join rows and relies on existing tag joins that filter `tags.deleted_at IS NULL` to keep deleted tags invisible until restored.
- Undo actions restore persisted data snapshots and query-derived fields are intentionally refetched, not snapshotted.
- UI undo actions do not restore selection, focused rows, modal open state, sort order, filters, or scroll position.
- Multi-row undo loops stop on the first mutation failure; failed initial applies do not push actions because `execute()` only pushes after successful `apply()`.

## Assumptions, blockers, and residual risks

- Assumption: transaction restore should allow nullable `subcategory_id` rows such as transfer/adjustment transactions and validate active subcategory/category only when a subcategory id is present.
- Assumption: preserving one custom shortcut override per command is the intended compatibility behavior for existing localStorage values.
- Residual risk: manual browser keyboard behavior was not exercised in Chromium against a seeded app database; automated tests verify shortcut normalization/registry/history/server restore contracts, but not full in-browser focus and keydown behavior.
- Residual risk: external provider workflows and opaque AI chat mutations remain intentionally non-undoable until reversible action details exist.
- Blockers: none for the committed implementation.
