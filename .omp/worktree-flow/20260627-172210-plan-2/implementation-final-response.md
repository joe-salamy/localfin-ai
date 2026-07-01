Implemented the approved plan and committed it.

- Commit: `c65b0b105bb5b73563093bef8ff4e1d893a27947`
- Branch: `feature/plan-2`
- Worktree: `C:/Users/joesa/Code/localfin-ai-plan-2`
- Handoff written: `.omp/handoff/implementation-summary.md`
- `.omp/handoff/` left uncommitted as required.
- Final `git status --short`: only workflow artifacts remain uncommitted:
  - `M .omp/worktree-flow/plan-2/plan.md`
  - `?? .omp/handoff/`

Implemented scope:

- Plaid/Akoya dependencies and provider env config.
- `createApp()` Express factoring and `/api/account-linking` mount.
- Provider SQLite schema/migrations.
- AES-256-GCM credential encryption.
- Plaid and Akoya provider adapters.
- Provider mapping, account linking, sync orchestration, idempotent provider transaction import, balance adjustments, disconnect handling.
- Account-linking HTTP routes.
- Frontend provider types, query keys, hook, Setup linking/status/sync/disconnect UI, Add Transactions manual sync card.
- README provider `.env` setup.
- Provider mapper, sync, and route tests.

Verification run:

- `npm run typecheck` â€” passed.
- `npm run lint` â€” passed.
- `node --import tsx --test server/provider-mappers.test.ts server/provider-sync.test.ts server/account-linking-routes.test.ts` â€” passed, 13/13.
- `npm test` â€” passed, 44/44.
- Additional migration rerun after fixing legacy DB startup: `node --import tsx --test --test-reporter=tap server/core-invariants.test.ts --test-name-pattern "tag migration|database migration"` â€” passed, 14/14 under this Node runner.

Skipped:

- Plaid sandbox manual smoke, Akoya sandbox manual smoke, and Add Transactions live provider sync smoke were not run because provider credentials/live connections were unavailable in this worktree.
