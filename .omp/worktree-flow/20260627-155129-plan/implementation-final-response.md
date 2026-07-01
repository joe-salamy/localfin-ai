Implemented the approved plan in the current worktree.

## Commit

- Branch: `feature/plan`
- Worktree: `C:/Users/joesa/Code/localfin-ai-plan`
- Commit: `f4503148645049a0b90974adabd75ab977ebae39`
- Message: `Implement plan`

## What changed

Implemented first-class transaction tags end to end:

- SQLite schema/migration:
  - `tags`
  - `transaction_tags`
  - active tag uniqueness by normalized name + type
- Backend:
  - tag CRUD service and `/api/tags` routes
  - transaction tag persistence, replacement, bulk add/remove
  - `tagIds` filters with OR semantics
  - `tag:` / `tags:` transaction search
  - dashboard tag filtering for transaction-based reports
  - new tag summary reporting
- Frontend:
  - shared tag types
  - `useTags`
  - tag query keys and invalidation
  - `TagPicker`
  - `TagManager`
  - `TagSummaryTable`
  - transaction input/history/inline/bulk tag editing
  - dashboard tag filter and Tag Summary card
  - Settings Tags card
- AI chat:
  - active tags in assistant/planning context
  - explicit-only tag prompt policy
  - `create_tag` / `update_tag`
  - explicit tag assignment/search/update/bulk-update support
  - tests for explicit trip tag assignment and no inferred tags without explicit wording

## Verification

Ran from `C:/Users/joesa/Code/localfin-ai-plan`:

- `npm test`
  - Passed.
  - Observed: `27` tests, `27` pass, `0` fail.
- `npm run typecheck`
  - Passed.
- `npm run lint`
  - Passed.

Manual browser UI smoke was not run because no `.env*` file exists in this worktree, so the planâ€™s normal dev-server scenario requiring local environment configuration could not be exercised without fabricating configuration.

## Handoff artifact

Wrote:

- `.omp/handoff/implementation-summary.md`

It includes:

- plan path
- worktree path
- branch
- commit SHA
- changed files
- behavior changes
- tests/checks run
- skipped checks and reason
- decisions/tradeoffs
- assumptions
- known risks/follow-up

## Final worktree state

`git status --short` shows only workflow artifacts untracked:

```text
?? .omp/handoff/
?? .omp/worktree-flow/
```

No source/test changes remain unstaged or uncommitted.
