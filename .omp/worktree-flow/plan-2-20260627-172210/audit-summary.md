# Audit Summary

## Worktree

- Path: `C:/Users/joesa/Code/localfin-ai-plan-2`
- Branch: `feature/plan-2`
- Base ref used for diff: `main` at merge-base `679b860d554ec5de3a6ad54f7fdf3d83d0985a5f`
- Audit fix commit: `52aada41f1e6bdc5177af9038c4d663e96fe2384` (`Fix audit findings`)

## Prior Implementation Summary Received

The implementation added read-only Plaid and Akoya account linking with encrypted provider credentials, manual provider sync, provider database tables/migrations, provider transaction mapping/idempotence, Express routes under `/api/account-linking`, React Query hooks, Setup-page provider linking/status controls, an Add Transactions sync entry point, README configuration notes, and backend route/service/mapper tests. The summary reported prior verification with `npm run typecheck`, focused provider tests, `npm run lint`, and `npm test`; credentialed Plaid/Akoya browser smoke checks were skipped because provider sandbox credentials were unavailable.

## Skills Loaded

- `audit-worktree`: required by the handoff prompt; used for worktree safety, diff-audit workflow, verification, commit, and required report fields.
- No repo-specific `.agent-harness/skills/*/SKILL.md` files were present in this worktree when checked, so no additional project skill was loaded.

## Audit Findings and Fixes

1. Plaid OAuth redirect flow lost the Link token across browser redirects.
   - Fix: `src/pages/SetupPage.tsx` now stores the Plaid Link token and target institution in `sessionStorage`, restores it when Plaid returns with `oauth_state_id`, passes `receivedRedirectUri`, reopens Link, and clears the stored token on success/exit.

2. Setup allowed `Sync now` on inactive provider connections and could show a successful zero-result sync.
   - Fix: `src/pages/SetupPage.tsx` disables per-connection sync for non-`active` connections and surfaces reconnect copy via the button title/guard.

3. Explicit backend sync of an inactive connection returned success with an empty result.
   - Fix: `server/services/account-linking.ts` now rejects `syncProviderConnections({ connectionId })` when the requested connection exists but is not `active`, allowing the route to return an error instead of a false success envelope.
   - Coverage: added `syncing an inactive requested connection rejects instead of returning an empty success`.

4. Provider `null`/blank balances could be coerced to `0`, creating balance adjustments that zeroed local balances instead of warning and skipping.
   - Fix: `server/services/account-linking.ts` `readNumber` now preserves `null`, `undefined`, and blank strings as missing values.
   - Coverage: added `Plaid sync skips null provider balances instead of zeroing accounts`.

5. Akoya 403 responses were not marked `needs_reauth`.
   - Fix: `server/services/account-linking.ts` now marks Akoya 401 and 403 failures as `needs_reauth`.
   - Coverage: added `Akoya 403 after refresh marks connection needs_reauth`.

6. Akoya sync ignored the provider ID captured on the connection and used the current environment provider ID instead.
   - Fix: `server/services/account-linking.ts` now passes `connection.akoya_provider_id` to Akoya balance and transaction calls.
   - Coverage: added `Akoya sync uses the provider id stored on the connection`.

## Files Changed by Audit Commit

- `server/services/account-linking.ts`
- `server/provider-sync.test.ts`
- `src/pages/SetupPage.tsx`

Workflow artifacts intentionally left uncommitted:

- `.omp/worktree-flow/plan-2/plan.md` remained modified before the audit and was not staged.
- `.omp/handoff/` remains untracked, including this audit summary.

## Verification

Commands run from `C:/Users/joesa/Code/localfin-ai-plan-2`:

1. `node --import tsx --test server/provider-sync.test.ts server/account-linking-routes.test.ts server/provider-mappers.test.ts`
   - Passed: 17/17 tests.

2. `npm run typecheck`
   - First audit-fix run failed with two `TS7006` implicit-`any` diagnostics in `server/provider-sync.test.ts` for mocked Akoya provider-client inputs.
   - Fix: added explicit `{ providerId?: string }` parameter annotations.
   - Final result: passed.

3. `npm run lint`
   - Passed.

4. `npm test`
   - Passed: 48/48 tests.

## Skipped Checks

- Plaid sandbox browser smoke: skipped because the worktree/session still does not provide Plaid sandbox credentials.
- Akoya sandbox browser smoke: skipped because the worktree/session still does not provide Akoya sandbox credentials.
- Add Transactions live provider sync browser smoke: skipped because it requires an active live provider connection from one of the skipped credentialed flows.

## Residual Risks / Follow-up

- Real Plaid OAuth and Akoya browser flows remain unverified against live provider sandboxes in this worktree because credentials were unavailable.
- Provider payload normalization is covered by mocked/common shapes; unusual Plaid/Akoya payload variants may still need adjustment after credentialed sandbox testing.
