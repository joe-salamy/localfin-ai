# Merge Conflict Context

## Branches

- Base branch: main
- Feature branch: feature/app-undo-redo-keyboard-support

## Plan

- Path: .omp/worktree-flow/20260630-220709-app-undo-redo-keyboard-support/plan.md

## Merge base

ea4db1091e53747f4e19faca03a44162d5582f83

## Conflicted files

src/components/features/MultiTransactionTable.tsx
src/components/features/TagManager.tsx
src/components/features/TransactionTable.tsx
src/pages/SetupPage.tsx
src/pages/TransactionHistoryPage.tsx

## Status

```text
M .omp/worktree-flow/20260630-220709-app-undo-redo-keyboard-support/plan.md
M  server/core-invariants.test.ts
M  server/routes/accounts.ts
M  server/routes/categories.ts
M  server/routes/tags.ts
M  server/routes/transactions.ts
M  server/services/accounts.ts
M  server/services/categories.ts
M  server/services/tags.ts
M  server/services/transactions.ts
M  src/App.tsx
M  src/components/features/BulkEditModal.tsx
UU src/components/features/MultiTransactionTable.tsx
UU src/components/features/TagManager.tsx
A  src/components/features/TagPicker.test.ts
M  src/components/features/TagPicker.tsx
UU src/components/features/TransactionTable.tsx
A  src/components/features/tagPickerCreateSelection.ts
M  src/features/shortcuts/ShortcutContext.ts
M  src/features/shortcuts/ShortcutHint.tsx
M  src/features/shortcuts/ShortcutProvider.tsx
A  src/features/shortcuts/commands.test.ts
M  src/features/shortcuts/commands.ts
M  src/features/shortcuts/hooks.ts
A  src/features/shortcuts/normalize.test.ts
M  src/features/shortcuts/normalize.ts
A  src/features/undo-redo/UndoRedoContext.ts
A  src/features/undo-redo/UndoRedoProvider.tsx
A  src/features/undo-redo/financeSnapshots.ts
A  src/features/undo-redo/history.test.ts
A  src/features/undo-redo/history.ts
A  src/features/undo-redo/hooks.ts
A  src/features/undo-redo/index.ts
M  src/hooks/useAccounts.ts
M  src/hooks/useCategories.ts
M  src/hooks/useTags.ts
M  src/hooks/useTransactions.ts
M  src/pages/SettingsPage.tsx
UU src/pages/SetupPage.tsx
UU src/pages/TransactionHistoryPage.tsx
?? .omp/handoff/
```

## Base commits since merge base

```text
05efa99 Harness artifacts: Confirmation Popups Setting
d45cf9e Harness: Confirmation Popups Setting
```

## Feature commits since merge base

```text
0931b54 Fix audit findings
3fe8c24 Implement plan
```

## Resolution rules

1. Latest base behavior is presumed correct unless the approved plan explicitly supersedes it.
2. Feature intent comes from the approved plan and implementation summary.
3. Preserve audited feature behavior when compatible with latest base.
4. Prefer the smallest conflict-only edit.
5. Remove all conflict markers.
