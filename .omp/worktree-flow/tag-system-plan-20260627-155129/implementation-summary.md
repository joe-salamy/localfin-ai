# Implementation Summary

## Plan

- Approved plan path: `.omp/worktree-flow/plan/plan.md`

## Worktree and Branch

- Worktree path: `C:/Users/joesa/Code/localfin-ai-plan`
- Branch: `feature/plan`
- Commit SHA: `f4503148645049a0b90974adabd75ab977ebae39`
- Commit message: `Implement plan`

## Changed Files

### Backend schema, routes, services, and tests

- `server/db/schema.sql`
- `server/db/index.ts`
- `server/config/app.ts`
- `server/index.ts`
- `server/routes/tags.ts`
- `server/routes/transactions.ts`
- `server/routes/dashboard.ts`
- `server/services/tags.ts`
- `server/services/transactions.ts`
- `server/services/transaction-search.ts`
- `server/services/dashboard.ts`
- `server/services/charts.ts`
- `server/core-invariants.test.ts`

### AI chat support and tests

- `server/services/ai-chat/types.ts`
- `server/services/ai-chat/prompting.ts`
- `server/services/ai-chat/input-validators.ts`
- `server/services/ai-chat/entity-resolution.ts`
- `server/services/ai-chat/action-preparation.ts`
- `server/services/ai-chat/action-executor.ts`
- `server/services/ai-chat/chat-runner.ts`
- `server/agent-system.test.ts`
- `server/ai-chat-refactor.test.ts`

### Frontend hooks, UI, and pages

- `src/types/index.ts`
- `src/lib/queryKeys.ts`
- `src/hooks/useTags.ts`
- `src/hooks/useAI.ts`
- `src/hooks/useTransactions.ts`
- `src/hooks/useDashboard.ts`
- `src/components/features/TagPicker.tsx`
- `src/components/features/TagManager.tsx`
- `src/components/features/TagSummary.tsx`
- `src/components/features/MultiTransactionTable.tsx`
- `src/components/features/TransactionTable.tsx`
- `src/components/features/BulkEditModal.tsx`
- `src/pages/TransactionHistoryPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/SettingsPage.tsx`

## Behavior Changes

- Added first-class `tags` and `transaction_tags` SQLite tables, including active-tag uniqueness by normalized name plus type and migration-time table/index creation for existing databases.
- Added shared TypeScript tag types: `TagType`, `Tag`, `CreateTagData`, `UpdateTransactionData`, `BulkTransactionUpdateData`, `TagSummary`, and `TagCategorySummary`.
- Added `/api/tags` CRUD endpoints and tag hooks/query keys on the frontend.
- Added a tag service with active tag CRUD, soft deletion, tag validation, transaction-tag replacement/add/remove helpers, transaction tag lookups, and explicit AI tag resolution/creation by name.
- Transactions now persist and return `tags: Tag[]`; create/bulk-create accepts `tag_ids`; single update replaces the full tag set through `tag_ids`; bulk update adds/removes tags without replacing unrelated tags.
- Transaction list filters now accept repeated `tagIds` with OR semantics across selected active tags.
- Transaction search now supports `tag:`/`tags:` field aliases and generic term matching against active tag names while preserving LIKE metacharacter escaping.
- Dashboard transaction-based reports now accept tag filters for category summary, metrics, sankey money flow, and new tag summary. Account summary and net-worth chart intentionally remain date-only.
- Added backend `getTagSummary` with spend, income, signed net, distinct transaction count, and category breakdown per active tag.
- Added reusable frontend tag UI:
  - `TagPicker` for existing tag multi-select and inline creation with type selection.
  - `TagManager` in Settings for create/update/delete/color management with toast feedback.
  - `TagSummaryTable` for dashboard tag totals and expandable category breakdown.
- Added tags to transaction input grid, pasted transaction rows, transaction history filters, inline transaction edit, read-mode tag chips, and bulk edit add/remove flows.
- Added dashboard tag filter UI and helper text explaining which cards are tag-filtered.
- AI chat now includes active tags in planning/assistant context, advertises explicit tag actions/fields, supports `create_tag` and `update_tag`, resolves explicit tag IDs/names/objects for create/update/search/bulk-update actions, creates missing explicitly requested tags for transaction creation/replacement, and includes tag summaries in search results.
- AI prompt policy now states tags are explicit-only and must not be inferred from merchant names, locations, categories, or subcategories.
- AI categorization (`server/services/ai.ts`) and statement parsing (`server/services/parser.ts`) were intentionally left unchanged; tags from statements remain manual UI assignments.

## Tests and Checks Run

- `npm test`
  - Result: passed.
  - Observed: 27 tests, 27 pass, 0 fail.
  - Covered new tag CRUD/filter/search/delete cleanup, bulk tag add/remove semantics, tag summary totals/category breakdown, tag LIKE escaping, explicit AI trip tag creation/assignment, and no inferred tags without explicit wording.
- `npm run typecheck`
  - Result: passed after fixing two AI tag type issues and adding required `tags: []` to an AI planning-context test fixture.
- `npm run lint`
  - Result: passed.

## Skipped Checks

- Manual browser UI smoke from the plan was skipped because no `.env*` file exists in this worktree, so the normal dev-server scenario requiring `OPENROUTER_API_KEY` could not be run here without fabricating local configuration.
- No frontend test runner was added; the approved plan explicitly says not to add one for this implementation unless complex pure UI logic requires it. Verification relied on TypeScript, lint, server integration tests, and compile-time coverage of the React code.

## Implementation Decisions and Tradeoffs

- Tag type remains a fixed literal union: `custom`, `trip`, `event`, `person`, `reimbursable`, `tax`; no user-editable tag type table was added.
- Transaction-tag filtering uses `EXISTS` subqueries instead of joining `transaction_tags` into main transaction selects, avoiding duplicate transaction rows.
- Single-transaction edits replace the full tag set, matching inline-edit semantics. Bulk edits use separate add/remove sets so unrelated tags survive.
- Dashboard tag filters were applied only to transaction-based reports. Account summary and net-worth chart stay unfiltered because tag-filtered balances would be misleading.
- Soft-deleting a tag also removes its transaction join rows in the same transaction, so deleted tags disappear from transaction details immediately.
- AI executor honors tag fields sent by the model, but the prompt/tests enforce the explicit-only policy. This matches the plan’s note that the executor cannot prevent a malicious model from sending tag fields.
- Inline pasted tag values in the input grid match existing tag IDs or active tag names and ignore unknown names rather than auto-creating tags.

## Assumptions

- Existing databases should be migrated in-place by `ensureTagTables` during startup, independent of whether `schema.sql` has already been applied.
- UI callers use active tags from `useTags`; deleted tags are not shown and transaction details no longer include them after deletion.
- Repeated `tagIds` query parameters are the canonical API shape for frontend dashboard/history tag filters.
- `resolveEntityColor` remains the shared chip/color rendering mechanism for tag UI.

## Known Risks and Follow-Up

- Manual UI smoke is still recommended in an environment with `.env` present. The specific unverified paths are inline tag creation in the grid/history, settings tag color/name edits, dashboard visual filtering, and bulk modal interaction.
- AI explicit-only behavior depends on prompt compliance. Tests cover the intended tool-loop contract, but executor-level hard rejection of inferred tags was intentionally not implemented per plan.
- Large frontend integration was verified by typecheck/lint rather than browser automation because the dev runtime could not be started without normal local environment configuration.
