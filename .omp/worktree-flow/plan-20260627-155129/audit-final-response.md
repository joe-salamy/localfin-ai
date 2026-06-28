Audit complete.

- Worktree path: `C:/Users/joesa/Code/localfin-ai-plan`
- Branch: `feature/plan`
- Base branch/ref used for diff: `main`
- Merge base: `3bac8b0bc6c29f0fcee7731d90e5c796485fe53d`
- Prior implementation audited: `f4503148645049a0b90974adabd75ab977ebae39` (`Implement plan`)
- Audit fix commit: `40a718407dbb41c5ba843a6525fbf44d0f8fee21` (`Fix audit findings`)
- Audit handoff written: `.omp/handoff/audit-summary.md`
- Final status: clean except untracked workflow artifacts:
  - `.omp/handoff/`
  - `.omp/worktree-flow/`

## Prior implementation summary, briefly restated

The prior implementation added first-class many-to-many transaction tags: backend tag tables/services/routes, transaction tag CRUD/filter/search, dashboard tag filtering and tag summary reporting, frontend tag pickers/management/history/input/bulk edit UI, and explicit-only AI chat tag support.

## Skills loaded

- `audit-worktree`: required by the prompt; used for worktree safety, `main...HEAD` diff audit, fix/verify/commit flow, and summary output.
- No additional repo-specific skills were available/needed beyond the provided project rules in `AGENTS.md`.

## Confirmed issues fixed

1. **Migration FK breakage for upgraded databases**
   - File: `server/db/index.ts`
   - Problem: `transaction_tags` could be created before the existing legacy `transactions` table was rebuilt; SQLite could rewrite its FK to `transactions_legacy_kind`, which is then dropped.
   - Fix: preserve existing `transaction_tags` rows in a temp table, drop `transaction_tags` before the transaction rebuild, recreate it against the final `transactions` table, restore rows, and recreate indexes.
   - Test: added `tag migration preserves transaction_tags foreign key after transaction rebuild` in `server/core-invariants.test.ts`.

2. **AI tag filters ignored advertised camelCase `tagIds`**
   - File: `server/services/ai-chat/action-preparation.ts`
   - Problem: AI action contract allowed `tagIds`, but `transactionSearchFilters()` only read snake_case tag fields.
   - Fix: accept `tagIds` and `tagId` in addition to `tag_ids`, `tag_id`, and `tags`.
   - Test: extended `server/agent-system.test.ts` to prove `search_transactions` with camelCase `tagIds` returns only the tagged transaction.

3. **AI search-repair tag parsing captured target prepositions**
   - File: `server/services/ai-chat/action-preparation.ts`
   - Problem: `add tag Reimbursable to it` could be parsed as tag name `Reimbursable to it`.
   - Fix: treat `to`/`for`/`on` as add-tag terminators and `from`/`off` as remove-tag terminators.
   - Test: added `search repair extracts tag names before target prepositions` in `server/ai-chat-refactor.test.ts`.

4. **Bulk Edit modal retained stale tag selections after successful close/reopen**
   - Files:
     - `src/components/features/BulkEditModal.tsx`
     - `src/pages/TransactionHistoryPage.tsx`
   - Problem: parent-driven close after a successful mutation left the modal mounted, so `addTagIds`/`removeTagIds` persisted into the next bulk edit.
   - Fix: `TransactionHistoryPage` now mounts `BulkEditModal` only while open, so successful close unmounts and clears internal state. `BulkEditModal` also uses a shared `resetState()` for manual close/cancel.
   - Smoke: browser-tested the actual React UI against a temporary dev DB; after applying a tag through Bulk Edit, reopening showed `Tags to add`, `Tags to remove`, and Confirm disabled.

## Files changed by audit commit

- `server/db/index.ts`
- `server/core-invariants.test.ts`
- `server/services/ai-chat/action-preparation.ts`
- `server/agent-system.test.ts`
- `server/ai-chat-refactor.test.ts`
- `src/components/features/BulkEditModal.tsx`
- `src/pages/TransactionHistoryPage.tsx`

## Verification run

- `npm test`
  - Passed.
  - Observed: 29 tests, 29 pass, 0 fail.
- `npm run typecheck`
  - Passed.
- `npm run lint`
  - Passed.
- Browser UI smoke
  - Passed.
  - Started `npm run dev` with:
    - `LOCALFIN_DB_PATH=C:/Users/joesa/AppData/Local/Temp/localfin-audit-smoke.db`
    - `OPENROUTER_API_KEY=audit-smoke-key`
  - Seeded data via real API.
  - Opened `http://127.0.0.1:5173/transactions/history`.
  - Filtered to the seeded rows, selected both, opened Bulk Edit, selected the seeded tag, confirmed, verified both rows had the tag through the API, reopened Bulk Edit, and observed empty add/remove tag pickers with Confirm disabled.

## Skipped checks

- No frontend test runner was added; the project does not have one, and the approved plan explicitly avoided adding one for this feature.
- Full manual cross-page smoke from the original implementation plan was not repeated. The audit browser smoke targeted the confirmed Bulk Edit stale-state defect.

## Residual risks / follow-up

- Full manual UI verification across transaction input, dashboard tag filters, settings tag CRUD, and inline edit is still recommended in a normal user environment.
- AI explicit-only tag behavior remains prompt/test-contract based, as the approved implementation summary documented; executor-level rejection of maliciously inferred tag fields was not added because it was outside the approved plan.
