# Comprehensive Tech Debt Refactor Audit Summary

## Worktree and Comparison

- Worktree: `/mnt/c/Users/joesa/code/localfin-ai-comprehensive-tech-debt-refactor`
- Branch: `feature/comprehensive-tech-debt-refactor`
- Base branch/ref: local `main` at merge base `9d13404bba0c985d4d1c187ba9a7a514e539350f`
- Audited implementation head before fixes: `3832723`
- Audit-fix commit: `792066e` — `Fix audit findings`
- Comparison scope: `main...HEAD`, excluding the prohibited scratchpad paths.

## Prior Implementation Summary Received

The handoff described a 155-file behavior-preserving refactor covering the Node/Vitest toolchain, strict TypeScript and ESLint coverage, centralized Express error semantics, ordered SQLite migrations, shared Node-neutral contracts, runtime API validation, centralized React Query invalidation, UI feature extraction, AI preparation splitting, and backend service facades. It reported clean dependency, static-analysis, test, build, and disposable-database smoke checks. The summary was treated as intent rather than proof and checked against the actual committed branch delta.

## Skills Loaded

- `audit-worktree`: required worktree safety, diff, verification, commit, and handoff workflow.
- `localfin-react-query-ui`: loaded because the implementation changes React hooks, query invalidation, Vite/Vitest configuration, API validation, and rendered UI behavior.

## Confirmed Findings and Fixes

1. **Akoya network failures bypassed the stable 502 boundary.**
   - `fetch` rejections escaped as ordinary errors because only response parsing was wrapped.
   - Added one shared Akoya request boundary that translates network failures to `UpstreamServiceError("Akoya request failed")` while keeping environment/configuration lookup outside the upstream catch.

2. **Plaid environment/configuration failures were incorrectly reported as upstream 502 failures.**
   - `getPlaidClient()` executed inside each provider catch, so missing `PLAID_CLIENT_ID`, `PLAID_SECRET`, or invalid `PLAID_ENV` was wrapped as a public provider failure.
   - Moved client/configuration creation before each request catch. Only actual SDK/request failures now cross as the stable Plaid 502 error.

3. **Wrapped provider errors broke production sync policy.**
   - Plaid pagination-mutation retry logic inspected only the outer error, but the provider client now stores the Plaid error code in a nested `cause`; production would not retry `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`.
   - Akoya 401/403 handling had the same defect; wrapped failures no longer moved connections to `needs_reauth`.
   - Added cycle-safe cause-chain inspection and regression coverage for wrapped Plaid retry and wrapped Akoya reauthentication transitions.

4. **OpenRouter retained unredacted non-2xx provider bodies.**
   - Raw response text entered both the `cause` chain and JSONL error logs.
   - Added redaction for the configured API key, bearer credentials, and common token/secret fields before constructing the retained error detail or writing the log. The public error remains exactly `OpenRouter request failed` with status 502.

5. **Migration 6 failed on nullable legacy timestamps.**
   - Legacy conversation/message rows with null `created_at` or `updated_at` violated the rebuilt tables' `NOT NULL` constraints, blocking startup instead of converging.
   - Coalesced absent/null timestamps to SQLite's current timestamp while preserving non-null legacy values.
   - Added a direct legacy fixture covering null title/content/role/status/timestamps, preserved request/action/log/status/timestamp fields, deleted-row omission, role checks, and conversation-message cascade behavior.

6. **Provider contracts were still duplicated in the account-linking service.**
   - Removed the local duplicate provider summary/result/type declarations.
   - The service now imports and re-exports the canonical types from `shared/contracts`, preserving its public type surface without a second contract owner.

7. **Required provider/OpenRouter boundary tests were absent.**
   - Added `server/provider-clients.test.ts` for Plaid/Akoya configuration precedence, Akoya network translation, non-2xx redaction, and malformed responses.
   - Added `server/openrouter.test.ts` for configuration precedence, stable 502 mapping, retained-cause redaction, and JSONL-log redaction.

## Files Changed by the Audit

- `server/ai/openrouter.ts`
- `server/db/index.test.ts`
- `server/db/migrations.ts`
- `server/openrouter.test.ts` (new)
- `server/provider-clients.test.ts` (new)
- `server/provider-sync.test.ts`
- `server/services/account-linking.ts`
- `server/services/providers/akoya-client.ts`
- `server/services/providers/plaid-client.ts`

Workflow files under `.omp/handoff/` and `.omp/worktree-flow/` remain untracked and were not included in commit `792066e`.

## Verification

All final implementation checks passed:

- `node --import tsx --test server/provider-clients.test.ts server/openrouter.test.ts server/provider-sync.test.ts server/db/index.test.ts` — 22/22 passed.
- `npm run test:server` — 72/72 passed.
- `npm run test:scripts` — 7/7 passed.
- `npm run test:frontend -- --maxWorkers=4` — 21 files, 89/89 passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed with no reported warnings/errors.
- `npm run build` — passed; Vite transformed 3,206 modules and emitted the production bundle.
- `npm audit` — zero vulnerabilities.
- `git diff --check main...HEAD -- . ':(exclude)scratchpad.md' ':(exclude)docs/scratchpad.md'` — passed before audit edits; final lint/typecheck/build/test checks passed after edits.

An initial unconstrained `npm test` reached 20 passing frontend files but failed to start one Vitest fork worker within its timeout. This was the same resource-bound worker startup mode recorded in the implementation handoff. The complete frontend suite then passed with `--maxWorkers=4`; server and script suites passed independently.

## Residual Risks and Plan-Conformance Gaps

- The approved account-linking decomposition named `repository.ts`, `plaid-sync.ts`, `akoya-sync.ts`, and `apply-sync.ts`, but the implementation still keeps those private responsibilities in `server/services/account-linking.ts`. The injected `AccountLinkingService` API is correct and covered, and duplicate shared contracts were removed, but the exact structural split remains incomplete.
- The approved rendered characterization matrix is broader than the committed tests. `SetupPage.test.tsx` mocks the extracted CRUD/provider sections and primarily covers page disclosure/count/callback behavior; it does not itself provide every account/category/provider interaction named in the plan. Transaction-table tests also cover a bounded subset of the full enumerated matrix.
- Migration tests now cover the corrected legacy conversation case, ledger bootstrap/rollback/retry/name/gap handling, tag-FK preservation, and legacy balance behavior, but the single `server/db/index.test.ts` inventory remains narrower than the plan's full populated current/provider/suspect convergence matrix.
- External Plaid, Akoya, and OpenRouter credentialed end-to-end calls were not run. Controlled client/service tests verify the changed local boundaries.
- The production bundle still emits Vite's existing chunk-size advisory (`index` JavaScript approximately 1.336 MB before gzip). Code splitting remains outside this audit fix.
