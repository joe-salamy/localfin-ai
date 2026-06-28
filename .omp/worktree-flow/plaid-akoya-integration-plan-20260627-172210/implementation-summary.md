# Implementation Summary

## Plan

- Plan path: `.omp/worktree-flow/plan-2/plan.md`
- Worktree path: `C:/Users/joesa/Code/localfin-ai-plan-2`
- Branch: `feature/plan-2`
- Commit: `c65b0b105bb5b73563093bef8ff4e1d893a27947`

## Changed Files

Committed implementation files:

- `README.md`
- `package.json`
- `package-lock.json`
- `server/app.ts`
- `server/index.ts`
- `server/config/app.ts`
- `server/db/schema.sql`
- `server/db/index.ts`
- `server/services/secret-encryption.ts`
- `server/services/providers/plaid-client.ts`
- `server/services/providers/akoya-client.ts`
- `server/services/provider-mappers.ts`
- `server/services/account-linking.ts`
- `server/routes/account-linking.ts`
- `server/provider-mappers.test.ts`
- `server/provider-sync.test.ts`
- `server/account-linking-routes.test.ts`
- `src/types/index.ts`
- `src/lib/queryKeys.ts`
- `src/hooks/useAccountLinking.ts`
- `src/pages/SetupPage.tsx`
- `src/pages/TransactionInputPage.tsx`

Uncommitted workflow artifacts intentionally left out of the commit:

- `.omp/worktree-flow/plan-2/plan.md` was already modified in the worktree and was not staged or committed.
- `.omp/handoff/` remains untracked as required.

## Behavior Changes

### Dependencies and configuration

- Added `plaid` and `react-plaid-link` dependencies through `npm install plaid react-plaid-link`.
- Added `/api/account-linking` to `API_ROUTES`.
- Added provider environment keys for `LOCALFIN_PROVIDER_SECRET`, Plaid credentials/env/redirect URI, Akoya credentials/base URLs/redirect URI/connector/provider/API version, and `FRONTEND_BASE_URL`.
- Added provider defaults/constants for LocalFin client name, Plaid Transactions-only read scope, 90 requested days, US/en settings, Akoya sandbox base URLs, `mikomo` sandbox defaults, and Akoya OAuth scope.

### Express app factoring

- Created `server/app.ts` exporting `createApp()`.
- Moved existing middleware, CORS handling, health route, route mounts, and JSON error handler into `createApp()`.
- Kept `server/index.ts` responsible for `dotenv.config()`, database startup initialization via `getDb()`, and `createApp().listen(...)`.
- Mounted `accountLinkingRouter` at `/api/account-linking` without changing existing route paths or the health response.

### Database schema and migrations

- Added provider account-linking tables:
  - `provider_connections`
  - `provider_accounts`
  - `provider_oauth_states`
- Added transaction provider identity columns:
  - `provider`
  - `provider_connection_id`
  - `provider_account_id`
  - `provider_transaction_id`
  - `provider_pending_transaction_id`
  - `provider_synced_at`
- Added idempotent provider table/index creation and nullable transaction column migration in `server/db/index.ts`.
- Kept migrated `provider_connection_id` as plain nullable `TEXT` for existing databases to avoid SQLite `ALTER TABLE` foreign-key limitations; new databases still receive the foreign key in `schema.sql`.
- Provider transaction indexes are created in the migration path after provider columns exist. This avoids startup failures for existing DBs because `schema.sql` executes before additive migrations.

### Credential encryption

- Added `server/services/secret-encryption.ts`.
- `encryptSecret` and `decryptSecret` derive a 32-byte key from `LOCALFIN_PROVIDER_SECRET` with SHA-256 and use AES-256-GCM with fresh 12-byte IVs.
- Missing or short `LOCALFIN_PROVIDER_SECRET` throws: `LOCALFIN_PROVIDER_SECRET not configured. Set it in .env before linking provider accounts.`
- Token ciphertext, IV, and tag are stored as base64 strings.

### Provider clients

- Added Plaid adapter in `server/services/providers/plaid-client.ts` as the only Plaid SDK importer.
- Plaid adapter supports Link token creation, public-token exchange, balance retrieval, Transactions Sync, and item removal with env validation and redacted provider errors.
- Added Akoya adapter in `server/services/providers/akoya-client.ts` as the only Akoya HTTP client.
- Akoya adapter supports authorization-code token exchange, refresh-token exchange, balances, paginated transaction calls, and token revoke. It treats Akoya revoke 404/501 as non-fatal for local disconnect.
- Provider error messages include status/provider text while redacting access, refresh, ID, public, bearer, secret, and token values.

### Provider mappers

- Added pure mapping helpers in `server/services/provider-mappers.ts`.
- Plaid sign behavior:
  - Asset debit: Plaid positive -> LocalFin negative expense.
  - Asset credit: Plaid negative -> LocalFin positive income.
  - Liability charge: Plaid positive -> LocalFin positive expense.
  - Liability payment: Plaid negative -> LocalFin negative income.
- Akoya sign behavior supports debit/credit memo fields and signed-amount fallback.
- Provider transaction ID fallback is a deterministic SHA-256 hash of provider, account ID, date, name, and amount.
- Plaid `credit`/`loan` accounts map to `liability`; other Plaid accounts map to `asset`.
- Akoya loan/LOC/credit-card/liability-like categories map to `liability`; Fidelity investment/deposit/unknown categories map to `asset`.

### Account-linking service and routes

- Added `server/services/account-linking.ts` implementing the approved exported backend contract.
- Added `server/routes/account-linking.ts` implementing:
  - `GET /connections`
  - `POST /plaid/link-token`
  - `POST /plaid/exchange`
  - `POST /akoya/authorize`
  - `GET /akoya/callback`
  - `POST /sync`
  - `DELETE /connections/:id`
- Connection list returns provider summaries with linked provider account summaries.
- Plaid exchange stores encrypted access token, external item ID, institution metadata, creates provider account links, and creates local accounts.
- Akoya authorization stores 10-minute CSRF state and returns an env-driven authorization URL.
- Akoya callback validates state, exchanges code for tokens, stores encrypted ID/access token and refresh token, and redirects the browser back to Setup.
- Manual sync fetches provider network data before opening the SQLite transaction, then applies local mutations in one DB transaction per connection.
- Plaid sync loops with count 500 until `has_more` is false and persists `next_cursor` only after local writes succeed.
- Plaid `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` restarts once from the original cursor; a second failure marks the connection `error` and stores `last_error`.
- Akoya sync refreshes tokens before data calls, rereads a 90-day window, and relies on provider transaction IDs for idempotence because public docs do not provide a removed feed.
- Akoya 401/403 during refresh/data marks the connection `needs_reauth` and preserves local accounts/transactions.
- Provider accounts create local accounts with `initial_balance = 0` and no color. Name collisions append provider labels and then provider-account suffixes.
- Provider transactions insert with `subcategory_id = NULL`, `comment = NULL`, `ai_suggested = 0`, no AI categorization, and no transfer auto-classification.
- Modified provider transactions update provider-owned fields while preserving user-managed category/comment/AI fields.
- Plaid removed transactions are soft-deleted locally; local accounts remain.
- Balance sync inserts `Provider balance sync` adjustment transactions when provider current balance differs from the local computed balance by at least one cent. Missing provider balances skip adjustment and add warnings.
- Disconnect revokes/removes upstream access when possible, then soft-deletes provider link rows while leaving local accounts and imported transactions in place.

### Frontend API/types/UI

- Added provider response types to `src/types/index.ts`.
- Added `queryKeys.accountLinking`.
- Added `src/hooks/useAccountLinking.ts` with connection query and Plaid/Akoya link, sync, and disconnect mutations. Successful mutations invalidate account-linking, accounts, transactions, and dashboard query groups.
- Added Setup provider card inside `AccountsSection` with:
  - `Connect US Bank (Plaid)`
  - `Connect Discover (Plaid)`
  - `Connect Fidelity (Akoya)`
  - connection status list
  - linked account balances
  - last sync/error display
  - per-connection `Sync now`
  - disconnect confirmation copy preserving local data
- Added Plaid Link flow with `react-plaid-link`, `receivedRedirectUri` only for OAuth redirect URLs, success exchange, success toast, and error-only exit toast.
- Added Akoya redirect handling on Setup for `provider=akoya&status=connected|error`, with toast and query-param cleanup.
- Added Add Transactions manual sync card between the page title and recent activity table. It links to Setup when no active provider connections exist and shows aggregate sync counts when sync succeeds.
- Provider sync writes directly to SQLite; the pasted/statement `MultiTransactionTable` remains unchanged.

### README

- Documented `.env` keys for provider linking and local credential encryption.
- Documented Akoya sandbox defaults and that Fidelity production `AKOYA_CONNECTOR`/`AKOYA_PROVIDER_ID` must come from Akoya Data Recipient Hub.

## Tests and Checks Run

All commands ran from `C:/Users/joesa/Code/localfin-ai-plan-2`.

1. `npm run typecheck`
   - Initial result: failed on `server/services/account-linking.ts` type issues.
   - Fixes applied: removed unused target institution helper and made Akoya account normalization return `ProviderAccountDraft | null` explicitly.
   - Final result: passed.

2. `node --import tsx --test server/provider-mappers.test.ts server/provider-sync.test.ts server/account-linking-routes.test.ts`
   - Initial result: failed because Node v22.18.0 in this workstation does not expose `mock.module`.
   - Fixes applied: added `setProviderClientsForTests` test injection in `account-linking.ts` and updated `provider-sync.test.ts` to use static service import plus per-test provider client overrides.
   - Final result: passed, 13/13 tests.

3. `npm run lint`
   - Final result: passed.

4. `npm test`
   - Initial result: failed two existing migration tests with `SQLITE_ERROR: no such column: provider` because `schema.sql` provider transaction indexes executed before additive migrations on legacy transaction tables.
   - Fix applied: moved provider transaction index creation to the idempotent migration path after provider columns are added.
   - Final result: passed, 44/44 tests.

5. Additional focused migration verification:
   - `node --import tsx --test --test-reporter=tap server/core-invariants.test.ts --test-name-pattern "tag migration|database migration"`
   - Result: passed. The command still executed all tests in `server/core-invariants.test.ts` under this Node runner; 14/14 passed.

## Skipped Checks

- Plaid sandbox manual browser smoke was not run because this worktree/session does not have Plaid sandbox credentials configured in `.env`.
- Akoya sandbox manual browser smoke was not run because this worktree/session does not have Akoya sandbox credentials configured in `.env`.
- Add Transactions manual browser sync smoke was not run because it requires at least one live active provider connection from the skipped Plaid/Akoya credentialed flows.
- `npm run build` was not run because the approved verification list required lint, typecheck, focused provider tests, and `npm test`; `npm run typecheck` already verified TypeScript compilation.

## Implementation Decisions and Tradeoffs

- Provider transaction indexes are not created directly by `schema.sql`; they are created by `migrate()` after columns are guaranteed to exist. This preserves existing database startup while still creating indexes for new and migrated databases.
- Added `setProviderClientsForTests` as a test-only service hook instead of depending on `node:test` module mocking. The workstation runs Node v22.18.0, where `mock.module` is unavailable in the observed test command. Production code still defaults to real Plaid/Akoya adapters.
- Akoya OAuth callback stores the connection and encrypted tokens; provider accounts and transactions are materialized during manual sync. This matches the manual-sync requirement and avoids doing data imports during the browser redirect.
- Provider balance adjustments are inserted only when the rounded cent delta is non-zero. Repeated syncs with unchanged provider balance and transactions do not create duplicate adjustments, covered by tests.
- Akoya re-read sync does not soft-delete transactions absent from the 90-day response because the plan noted no removed-transaction feed in the public docs.
- Local provider-created accounts are never deleted by disconnect or missing provider account data; only provider link rows are soft-deleted.

## Assumptions, Risks, and Follow-up

- Assumption: Plaid account/balance and transaction payloads match Plaid SDK shapes used in the adapters and tests.
- Assumption: Akoya/FDX sandbox/production payloads expose account and transaction fields among the common variants normalized by the service (`accounts`, `depositAccounts`, `investmentAccounts`, `transactions`, `depositTransactions`, etc.).
- Risk: Akoya public docs do not publish Fidelity production connector/provider IDs. The implementation is env-driven; bad Data Recipient Hub values will fail provider calls without code changes.
- Risk: If `LOCALFIN_PROVIDER_SECRET` changes after credentials are stored, decrypting existing provider tokens will fail. The service marks the connection `error` with the planned recovery message and preserves local data.
- Risk: Manual browser provider flows are unverified in this worktree because credentials were unavailable. Automated route/service/mapper tests cover local behavior and mocked provider responses, not real Plaid/Akoya network contracts.
- Follow-up when credentials are available: run Plaid sandbox smoke, Akoya sandbox smoke, and Add Transactions manual sync smoke from the approved plan.
