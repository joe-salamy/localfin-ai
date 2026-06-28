Audit pass complete.

- Worktree path: `C:/Users/joesa/Code/localfin-ai-plan-2`
- Branch: `feature/plan-2`
- Base ref used for diff: `main`
- Merge-base: `679b860d554ec5de3a6ad54f7fdf3d83d0985a5f`
- Audit fix commit: `52aada41f1e6bdc5177af9038c4d663e96fe2384` (`Fix audit findings`)
- Audit summary written: `.omp/handoff/audit-summary.md`
- Final status: only workflow artifacts remain outside the audit commit:
  - `M .omp/worktree-flow/plan-2/plan.md`
  - `?? .omp/handoff/`

## Prior implementation summary received

Implementation added read-only Plaid and Akoya account linking: encrypted provider credentials, provider schema/migrations, manual sync, provider mapping/idempotence, `/api/account-linking` routes, React Query hooks, Setup-page provider UI, Add Transactions sync card, README env docs, and backend route/service/mapper tests. Prior summary reported lint/typecheck/provider tests/full tests passing; live Plaid/Akoya browser smoke checks were skipped because sandbox credentials were unavailable.

## Skills loaded

- `audit-worktree`: required by the prompt; followed for worktree safety, diff audit, fixes, verification, commit, and report.
- No additional repo-specific skills loaded: `.agent-harness/skills/*/SKILL.md` was not present in this worktree when checked.

## Issues found and fixed

1. **Plaid OAuth redirect lost Link token**
   - File: `src/pages/SetupPage.tsx`
   - Problem: React state was cleared by Plaid OAuth browser redirect, so returning with `oauth_state_id` could not resume Link.
   - Fix: store Plaid Link token + target institution in `sessionStorage`, restore it on `oauth_state_id`, pass `receivedRedirectUri`, reopen Link, and clear storage on success/exit.

2. **Inactive provider connections could show false sync success in Setup**
   - File: `src/pages/SetupPage.tsx`
   - Problem: `Sync now` rendered for `needs_reauth`/`error` connections; backend could return an empty result, producing a successful zero-count toast.
   - Fix: per-connection sync is now disabled for non-`active` connections with reconnect copy/guard.

3. **Explicit backend sync of inactive connection returned success**
   - File: `server/services/account-linking.ts`
   - Problem: `syncProviderConnections({ connectionId })` skipped non-active rows and returned `[]`, allowing route success for no sync.
   - Fix: explicit inactive connection sync now rejects with a reconnect-before-sync error.
   - Test added: `syncing an inactive requested connection rejects instead of returning an empty success`.

4. **Null provider balances were coerced to zero**
   - File: `server/services/account-linking.ts`
   - Problem: `Number(null) === 0`, so unavailable Plaid/Akoya balances could create `Provider balance sync` adjustments that zeroed local accounts.
   - Fix: `readNumber` preserves `null`, `undefined`, and blank strings as missing values.
   - Test added: `Plaid sync skips null provider balances instead of zeroing accounts`.

5. **Akoya 403 did not mark `needs_reauth`**
   - File: `server/services/account-linking.ts`
   - Problem: only 401 failures changed connection status; 403 stayed active and retriable as if credentials were valid.
   - Fix: Akoya 401 and 403 failures now mark connection `needs_reauth`.
   - Test added: `Akoya 403 after refresh marks connection needs_reauth`.

6. **Akoya sync used current env provider ID instead of stored connection provider ID**
   - File: `server/services/account-linking.ts`
   - Problem: existing Akoya connections could break if `AKOYA_PROVIDER_ID` changed after linking.
   - Fix: balance and transaction calls now pass `connection.akoya_provider_id`.
   - Test added: `Akoya sync uses the provider id stored on the connection`.

## Files changed by audit commit

- `server/services/account-linking.ts`
- `server/provider-sync.test.ts`
- `src/pages/SetupPage.tsx`

## Verification run

From `C:/Users/joesa/Code/localfin-ai-plan-2`:

1. `node --import tsx --test server/provider-sync.test.ts server/account-linking-routes.test.ts server/provider-mappers.test.ts`
   - Passed: 17/17 tests.

2. `npm run typecheck`
   - First audit-fix run failed with two `TS7006` diagnostics in `server/provider-sync.test.ts`.
   - Fixed by annotating mocked Akoya client input parameters.
   - Final result: passed.

3. `npm run lint`
   - Passed.

4. `npm test`
   - Passed: 48/48 tests.

## Skipped checks

- Plaid sandbox browser smoke: skipped; sandbox credentials unavailable in this worktree/session.
- Akoya sandbox browser smoke: skipped; sandbox credentials unavailable in this worktree/session.
- Add Transactions live provider sync smoke: skipped; requires an active live provider connection from the skipped credentialed flows.

## Residual risks

- Real Plaid OAuth and Akoya browser flows remain unverified against provider sandboxes because credentials were unavailable.
- Provider payload normalization is covered by mocked/common shapes; unusual provider payload variants may require adjustment after credentialed sandbox testing.
