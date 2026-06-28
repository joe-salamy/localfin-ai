# Audit Summary

## Worktree and Branch

- Worktree path: `C:/Users/joesa/Code/localfin-ai-plan`
- Branch: `feature/plan`
- Base branch/ref used for diff: `main`
- Merge base: `3bac8b0bc6c29f0fcee7731d90e5c796485fe53d`
- Prior implementation commit audited: `f4503148645049a0b90974adabd75ab977ebae39` (`Implement plan`)
- Audit fix commit: `40a718407dbb41c5ba843a6525fbf44d0f8fee21` (`Fix audit findings`)

## Prior Implementation Intent

The implementation added first-class many-to-many transaction tags with fixed tag types, backend tag CRUD, tag-aware transaction CRUD/filter/search, dashboard tag filters and tag summaries, frontend tag picking/management/bulk editing, and explicit-only AI chat tag support. The prior run reported passing `npm test`, `npm run typecheck`, and `npm run lint`, with manual UI smoke skipped.

## Skills Loaded

- `audit-worktree`: required by the handoff prompt; used for worktree safety checks, `main...HEAD` diff audit, fix/verify/commit flow, and required audit summary output.
- No additional repo-specific skills were present or required for this TypeScript/Express/React audit beyond the provided `AGENTS.md` project rules.

## Audit Method

- Confirmed current worktree is `C:/Users/joesa/Code/localfin-ai-plan`, not the primary `main` checkout.
- Confirmed current branch is `feature/plan`.
- Fetched refs and audited `main...HEAD`.
- Reviewed the approved plan and prior implementation summary.
- Split detailed review across backend persistence/services, frontend tag UI, and AI tag handling, then verified findings directly in the changed files.
- Fixed only confirmed audit findings.

## Confirmed Issues and Fixes

### 1. `transaction_tags` foreign key could point at the dropped legacy transaction table during upgrades

- Finding: On an existing database whose `transactions` table still required the kind-constraint rebuild, startup executed `schema.sql` before `migrate()`. The new `transaction_tags` table could be created while the legacy `transactions` table still existed. `migrateTransactionKindConstraint()` then renamed that parent to `transactions_legacy_kind` and dropped it, leaving `transaction_tags` with an invalid foreign-key target.
- Fix: `server/db/index.ts` now detects an existing `transaction_tags` table before the transaction rebuild, copies its rows to a temp table, drops it, rebuilds `transactions`, recreates `transaction_tags` against the final `transactions` table, restores rows, and recreates indexes.
- Coverage: Added `tag migration preserves transaction_tags foreign key after transaction rebuild` in `server/core-invariants.test.ts`; it creates a legacy database, initializes through the real migration path, checks `PRAGMA foreign_key_list(transaction_tags)`, and persists a tagged transaction.

### 2. AI search/bulk filters ignored advertised camelCase `tagIds`

- Finding: The AI action contract allowed `tagIds`, but `transactionSearchFilters()` only read `tag_ids`, `tag_id`, and `tags`. AI `search_transactions` or `bulk_update_transactions` actions using camelCase `tagIds` could silently run without the tag filter.
- Fix: `server/services/ai-chat/action-preparation.ts` now accepts both `tagIds` and `tagId` in addition to the existing snake_case fields.
- Coverage: Extended `agent creates an explicit trip tag and assigns it to a transaction` in `server/agent-system.test.ts` with an untagged matching control transaction and a `search_transactions` action using camelCase `tagIds`; it now asserts only the tagged transaction is returned.

### 3. Search-before-update tag repair could include target prepositions in tag names

- Finding: `requestedUpdateTags()` could parse `add tag Reimbursable to it` as tag name `Reimbursable to it` when repairing a search-only update into an `update_transaction` action.
- Fix: `server/services/ai-chat/action-preparation.ts` now treats `to`, `for`, and `on` as add-tag terminators, and `from`/`off` as remove-tag terminators.
- Coverage: Added `search repair extracts tag names before target prepositions` in `server/ai-chat-refactor.test.ts`.

### 4. Bulk Edit modal retained stale tag selections after successful close/reopen

- Finding: `TransactionHistoryPage` closed `BulkEditModal` by setting `bulkEditOpen` false after a successful mutation, but the modal component stayed mounted and its internal `addTagIds`/`removeTagIds` state persisted. Reopening Bulk Edit could show stale tag selections and keep Confirm enabled for unrelated transactions.
- Fix: `TransactionHistoryPage.tsx` now mounts `BulkEditModal` only while `bulkEditOpen` is true, so successful close unmounts and resets modal state. `BulkEditModal.tsx` also uses a shared `resetState()` for manual close/cancel.
- Coverage: Browser smoke against a temporary dev database selected two seeded transactions, applied a tag through Bulk Edit, reopened Bulk Edit, and observed `addText: "Tags to add"`, `removeText: "Tags to remove"`, and `confirmDisabled: true`.

## Files Changed by Audit Commit

- `server/db/index.ts`
- `server/core-invariants.test.ts`
- `server/services/ai-chat/action-preparation.ts`
- `server/agent-system.test.ts`
- `server/ai-chat-refactor.test.ts`
- `src/components/features/BulkEditModal.tsx`
- `src/pages/TransactionHistoryPage.tsx`

## Verification

- `npm test`
  - Result: passed.
  - Observed: 29 tests, 29 pass, 0 fail.
  - Covers the migration regression, camelCase `tagIds` AI filtering, tag repair parsing, and existing backend/tag/AI invariants.
- `npm run typecheck`
  - Result: passed.
- `npm run lint`
  - Result: passed.
- Browser UI smoke
  - Started `npm run dev` with `LOCALFIN_DB_PATH=C:/Users/joesa/AppData/Local/Temp/localfin-audit-smoke.db` and `OPENROUTER_API_KEY=audit-smoke-key`.
  - Seeded account/category/subcategory/tag/two transactions through the real API.
  - Opened `http://127.0.0.1:5173/transactions/history`.
  - Filtered to `Audit Hotel`, selected both rows, opened Bulk Edit, selected the seeded `Audit Reimbursable ...` tag under Add tags, confirmed, verified both rows had the tag through the API, reopened Bulk Edit, and confirmed the reopened modal had empty add/remove tag pickers and disabled Confirm.

## Skipped Checks

- No additional frontend test runner was added; the project has none and the plan explicitly avoided adding one for this feature.
- Full manual cross-page smoke from the implementation plan was not repeated end-to-end. The audit browser smoke targeted the confirmed Bulk Edit stale-state issue only.

## Residual Risks / Follow-Up

- Full manual UI verification across input grid, dashboard tag filters, settings tag CRUD, and inline transaction edit is still recommended in a normal user environment. The audit smoke covered the fixed Bulk Edit reset path only.
- AI explicit-only enforcement remains prompt/test-contract based as documented in the prior implementation summary; executor-level rejection of maliciously inferred tag fields was not added because it was outside the approved plan.

## Workflow Artifacts

- `.omp/handoff/audit-summary.md` was written as a workflow artifact and intentionally not committed.
- `.omp/handoff/` and `.omp/worktree-flow/` remain untracked.
