# Merge Conflict Context

## Branches

- Base branch: main
- Feature branch: feature/plan

## Plan

- Path: .omp/worktree-flow/plan/plan.md

## Merge base

3bac8b0bc6c29f0fcee7731d90e5c796485fe53d

## Conflicted files

server/core-invariants.test.ts
server/db/index.ts
server/index.ts
server/routes/dashboard.ts
server/routes/transactions.ts
server/services/ai-chat/action-executor.ts
server/services/ai-chat/action-preparation.ts
server/services/ai-chat/entity-resolution.ts
server/services/ai-chat/input-validators.ts
server/services/charts.ts
server/services/dashboard.ts
server/services/transaction-search.ts
server/services/transactions.ts
src/components/features/BulkEditModal.tsx
src/components/features/MultiTransactionTable.tsx
src/components/features/TransactionTable.tsx
src/hooks/useAI.ts
src/hooks/useDashboard.ts
src/hooks/useTransactions.ts
src/lib/queryKeys.ts
src/pages/DashboardPage.tsx
src/pages/SettingsPage.tsx
src/pages/TransactionHistoryPage.tsx
src/types/index.ts

## Status

```text
M  server/agent-system.test.ts
M  server/ai-chat-refactor.test.ts
M  server/config/app.ts
UU server/core-invariants.test.ts
UU server/db/index.ts
M  server/db/schema.sql
UU server/index.ts
UU server/routes/dashboard.ts
A  server/routes/tags.ts
UU server/routes/transactions.ts
UU server/services/ai-chat/action-executor.ts
UU server/services/ai-chat/action-preparation.ts
M  server/services/ai-chat/chat-runner.ts
UU server/services/ai-chat/entity-resolution.ts
UU server/services/ai-chat/input-validators.ts
M  server/services/ai-chat/prompting.ts
M  server/services/ai-chat/types.ts
UU server/services/charts.ts
UU server/services/dashboard.ts
A  server/services/tags.ts
UU server/services/transaction-search.ts
UU server/services/transactions.ts
UU src/components/features/BulkEditModal.tsx
UU src/components/features/MultiTransactionTable.tsx
A  src/components/features/TagManager.tsx
A  src/components/features/TagPicker.tsx
A  src/components/features/TagSummary.tsx
UU src/components/features/TransactionTable.tsx
UU src/hooks/useAI.ts
UU src/hooks/useDashboard.ts
A  src/hooks/useTags.ts
UU src/hooks/useTransactions.ts
UU src/lib/queryKeys.ts
UU src/pages/DashboardPage.tsx
UU src/pages/SettingsPage.tsx
UU src/pages/TransactionHistoryPage.tsx
UU src/types/index.ts
?? .omp/handoff/
?? .omp/worktree-flow/plan/
```

## Base commits since merge base

```text
7302b4f prettier
a1f8888 harness stuff
```

## Feature commits since merge base

```text
40a7184 Fix audit findings
f450314 Implement plan
```

## Resolution rules

1. Latest base behavior is presumed correct unless the approved plan explicitly supersedes it.
2. Feature intent comes from the approved plan and implementation summary.
3. Preserve audited feature behavior when compatible with latest base.
4. Prefer the smallest conflict-only edit.
5. Remove all conflict markers.
