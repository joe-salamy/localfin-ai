## Context

Add read-only Plaid and Akoya account linking so LocalFin AI can import transactions and account values without pasted statements. The fixed target mapping is US Bank and Discover through Plaid, and Fidelity through Akoya. The user chose manual sync only, 90 days of initial transaction history, and encrypted-at-rest storage of provider credentials in local SQLite.

Provider docs used for the plan: Plaid Link token (`https://plaid.com/docs/api/link/#linktokencreate`), Plaid public-token exchange (`https://plaid.com/docs/api/items/#itempublic_tokenexchange`), Plaid Transactions Sync (`https://plaid.com/docs/api/products/transactions/#transactionssync`), Plaid accounts (`https://plaid.com/docs/api/accounts/#accountsget`), Akoya OAuth/token docs (`https://docs.akoya.com/guides/oauth` and embedded OpenAPI `get-token` content), Akoya balances (`https://docs.akoya.com/reference/getbalances`), and Akoya transactions (`https://docs.akoya.com/reference/gettransactions`). Akoya public docs do not publish Fidelity's production `providerId`/`connector`; those values must be configured from Akoya Data Recipient Hub, with sandbox defaults set to `mikomo`.

## Findings

- Backend entrypoint: `server/index.ts` initializes SQLite with `getDb()`, mounts routers from `API_ROUTES`, and emits JSON errors as `{ success: false, error }`.
- Route pattern: `server/routes/accounts.ts` and `server/routes/transactions.ts` use Express routers, Zod schemas, `parseRequest`, per-handler `try/catch`, 201 for creates, 404 for missing resources, and 400 JSON errors for service exceptions.
- Database pattern: `server/db/index.ts` reads `server/db/schema.sql`, runs idempotent `migrate(database)`, and uses `addColumnIfMissing` plus explicit `CREATE TABLE IF NOT EXISTS` blocks for additive schema.
- Current accounts are local-only: `server/services/accounts.ts` computes `current_balance` as `initial_balance + SUM(transactions.amount)`, and account reconciliation writes a `kind = 'adjustment'` transaction. Dashboard/category/goal spending queries ignore adjustments because they aggregate `kind = 'income'` and/or `kind = 'expense'` only.
- Current transactions are local-only: `server/services/transactions.ts` creates rows through `createTransaction`/`bulkCreateTransactions`, normalizes signs via `src/lib/transactionAmounts.ts`, and has duplicate detection on exact `(date, name, amount, account_id)`.
- Frontend API pattern: `src/lib/api.ts` expects backend envelopes `{ success, data, error }`, throws on non-OK or `success: false`, and exposes `apiGet`, `apiPost`, `apiPut`, `apiDelete`.
- Frontend query invalidation pattern: `src/hooks/useAccounts.ts` invalidates `queryKeys.accounts.all`, `queryKeys.transactions.all`, and `queryKeys.dashboard.all` after account mutations; provider link/sync mutations must do the same.
- Frontend placement: no existing Plaid/Akoya/provider UI exists under `src`. Use `src/pages/SetupPage.tsx` `AccountsSection` for linking/status/disconnect, and `src/pages/TransactionInputPage.tsx` for a compact "Sync linked accounts" entry point near existing statement import.
- Verification convention: `package.json` runs backend tests with Node's built-in runner (`npm test` => `node --import tsx --test "server/**/*.test.ts"`); no frontend test framework exists. Existing temp SQLite test pattern uses `LOCALFIN_DB_PATH`, `closeDbForTests()`, and `globalThis.fetch` mocking.

## Approach

### 1. Add dependencies and configuration

1. Run `npm install plaid react-plaid-link` so `package.json` and `package-lock.json` record the provider dependencies:
   - `plaid` for backend Plaid API calls.
   - `react-plaid-link` for frontend Plaid Link.
   - Do not add an Akoya SDK; use `fetch` because Akoya's docs expose standard OAuth/data HTTP endpoints.
2. Extend `server/config/app.ts`:
   - Add `API_ROUTES.accountLinking = "/api/account-linking"`.
   - Add these exact `ENV_KEYS` entries:
     - `localfinProviderSecret: "LOCALFIN_PROVIDER_SECRET"`
     - `plaidClientId: "PLAID_CLIENT_ID"`
     - `plaidSecret: "PLAID_SECRET"`
     - `plaidEnv: "PLAID_ENV"`
     - `plaidRedirectUri: "PLAID_REDIRECT_URI"`
     - `akoyaClientId: "AKOYA_CLIENT_ID"`
     - `akoyaClientSecret: "AKOYA_CLIENT_SECRET"`
     - `akoyaAuthBaseUrl: "AKOYA_AUTH_BASE_URL"`
     - `akoyaApiBaseUrl: "AKOYA_API_BASE_URL"`
     - `akoyaRedirectUri: "AKOYA_REDIRECT_URI"`
     - `akoyaConnector: "AKOYA_CONNECTOR"`
     - `akoyaProviderId: "AKOYA_PROVIDER_ID"`
     - `akoyaApiVersion: "AKOYA_API_VERSION"`
     - `frontendBaseUrl: "FRONTEND_BASE_URL"`
   - Add `PROVIDER_CONFIG` with these defaults and constraints:
     - `frontendBaseUrl`: default `"http://localhost:5173"`.
     - `plaidEnv`: default `"sandbox"`; allowed values `"sandbox" | "development" | "production"`.
     - `plaidClientName`: literal `"LocalFin AI"`.
     - `plaidProducts`: literal `["transactions"]`; do not request Plaid `auth` because the app is read-only and does not need account/routing numbers.
     - `plaidCountryCodes`: literal `["US"]`.
     - `plaidLanguage`: literal `"en"`.
     - `plaidClientUserId`: literal `"localfin-default-user"`.
     - `plaidDaysRequested`: literal `90`.
     - `akoyaAuthBaseUrl`: default `"https://sandbox-idp.ddp.akoya.com"`.
     - `akoyaApiBaseUrl`: default `"https://sandbox-products.ddp.akoya.com"`.
     - `akoyaApiVersion`: default `"v3"`.
     - `akoyaConnector`: default `"mikomo"`.
     - `akoyaProviderId`: default to `AKOYA_PROVIDER_ID`, then `AKOYA_CONNECTOR`, then `"mikomo"`.
     - `akoyaScope`: literal `"openid offline_access profile"`.
3. Update `README.md` setup only after implementation works. Add `.env` entries and mark Akoya Fidelity production IDs as Data Recipient Hub values:
   ```
   OPENROUTER_API_KEY=your_openrouter_key
   LOCALFIN_PROVIDER_SECRET=at_least_32_random_characters
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...
   PLAID_ENV=sandbox
   PLAID_REDIRECT_URI=http://localhost:5173/setup
   AKOYA_CLIENT_ID=...
   AKOYA_CLIENT_SECRET=...
   AKOYA_AUTH_BASE_URL=https://sandbox-idp.ddp.akoya.com
   AKOYA_API_BASE_URL=https://sandbox-products.ddp.akoya.com
   AKOYA_REDIRECT_URI=http://localhost:3001/api/account-linking/akoya/callback
   AKOYA_CONNECTOR=mikomo
   AKOYA_PROVIDER_ID=mikomo
   AKOYA_API_VERSION=v3
   FRONTEND_BASE_URL=http://localhost:5173
   ```
   For Fidelity production, replace `AKOYA_CONNECTOR` and `AKOYA_PROVIDER_ID` with the Fidelity values from Akoya Data Recipient Hub; do not hardcode a guessed Fidelity identifier.

### 2. Factor Express app construction and mount account-linking routes

1. Create `server/app.ts` exporting `createApp(): express.Express`.
   - Move the existing middleware, `/api/health`, router mounts, and error handler from `server/index.ts` into `createApp` unchanged.
   - Import and mount the new `accountLinkingRouter` at `API_ROUTES.accountLinking`.
2. Update `server/index.ts`:
   - Keep `dotenv.config()` and `getDb()` startup initialization.
   - Import `createApp` and call `createApp().listen(PORT, ...)` with the existing console message.
   - Do not change existing route paths or health response.
3. Existing callsites to update: only `server/index.ts` imports/router setup. There are no current imports of `app` because it is not exported today.

### 3. Add provider-linking schema and idempotent migrations

1. In `server/db/schema.sql`, insert the provider tables after the existing `accounts` table/index and before the `transactions` table so `transactions.provider_connection_id` can reference `provider_connections`.
2. Add table `provider_connections`:
   ```sql
   CREATE TABLE IF NOT EXISTS provider_connections (
     id TEXT PRIMARY KEY,
     provider TEXT NOT NULL CHECK(provider IN ('plaid', 'akoya')),
     target_institution TEXT NOT NULL CHECK(target_institution IN ('us_bank', 'discover', 'fidelity')),
     institution_id TEXT,
     institution_name TEXT NOT NULL,
     external_item_id TEXT,
     akoya_provider_id TEXT,
     akoya_connector TEXT,
     encrypted_access_token TEXT NOT NULL,
     access_token_iv TEXT NOT NULL,
     access_token_tag TEXT NOT NULL,
     encrypted_refresh_token TEXT,
     refresh_token_iv TEXT,
     refresh_token_tag TEXT,
     transactions_cursor TEXT,
     status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'needs_reauth', 'error', 'revoked')),
     last_sync_at TEXT,
     last_error TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     deleted_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_provider_connections_provider ON provider_connections(provider) WHERE deleted_at IS NULL;
   CREATE INDEX IF NOT EXISTS idx_provider_connections_status ON provider_connections(status) WHERE deleted_at IS NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_connections_external_item
     ON provider_connections(provider, external_item_id)
     WHERE external_item_id IS NOT NULL AND deleted_at IS NULL;
   ```
3. Add table `provider_accounts`:
   ```sql
   CREATE TABLE IF NOT EXISTS provider_accounts (
     id TEXT PRIMARY KEY,
     connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
     local_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     provider_account_id TEXT NOT NULL,
     name TEXT NOT NULL,
     official_name TEXT,
     mask TEXT,
     type TEXT NOT NULL CHECK(type IN ('asset', 'liability')),
     provider_type TEXT,
     provider_subtype TEXT,
     current_balance REAL,
     available_balance REAL,
     iso_currency_code TEXT,
     last_balance_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     deleted_at TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_accounts_connection_external
     ON provider_accounts(connection_id, provider_account_id)
     WHERE deleted_at IS NULL;
   CREATE INDEX IF NOT EXISTS idx_provider_accounts_local_account
     ON provider_accounts(local_account_id)
     WHERE deleted_at IS NULL;
   ```
4. Add table `provider_oauth_states` for Akoya CSRF/state validation:
   ```sql
   CREATE TABLE IF NOT EXISTS provider_oauth_states (
     state TEXT PRIMARY KEY,
     provider TEXT NOT NULL CHECK(provider IN ('akoya')),
     target_institution TEXT NOT NULL CHECK(target_institution IN ('fidelity')),
     redirect_after TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT NOT NULL,
     consumed_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_expires ON provider_oauth_states(expires_at);
   ```
5. In the existing `transactions` table definition, add these nullable provider identity columns after `ai_suggested`:
   ```sql
   provider TEXT CHECK(provider IN ('plaid', 'akoya')),
   provider_connection_id TEXT REFERENCES provider_connections(id) ON DELETE SET NULL,
   provider_account_id TEXT,
   provider_transaction_id TEXT,
   provider_pending_transaction_id TEXT,
   provider_synced_at TEXT,
   ```
   Add indexes:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_provider_transaction
     ON transactions(provider, provider_transaction_id)
     WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL AND deleted_at IS NULL;
   CREATE INDEX IF NOT EXISTS idx_transactions_provider_connection
     ON transactions(provider_connection_id)
     WHERE provider_connection_id IS NOT NULL;
   ```
6. In `server/db/index.ts` `migrate(database)`:
   - Execute the same `CREATE TABLE IF NOT EXISTS` and index statements for provider tables/indexes before adding `transactions.provider_connection_id`.
   - Use `addColumnIfMissing` for each new `transactions` column so existing databases migrate.
   - If SQLite rejects adding `provider_connection_id` with a foreign-key clause in an existing database, add it as plain nullable `provider_connection_id TEXT`; keep the schema.sql foreign key for new databases and rely on service-level connection validation for migrated databases.
   - Do not rebuild the existing `transactions` table unless a SQLite limitation forces it; the added columns are nullable.

### 4. Add encryption helpers for provider secrets

1. Create `server/services/secret-encryption.ts` with these exact exported types/functions:
   ```ts
   export interface EncryptedSecret {
     ciphertext: string;
     iv: string;
     tag: string;
   }

   export function encryptSecret(plaintext: string): EncryptedSecret;
   export function decryptSecret(secret: EncryptedSecret): string;
   ```
2. Implementation rules:
   - Read `process.env[ENV_KEYS.localfinProviderSecret]`.
   - If absent or shorter than 32 characters, throw `LOCALFIN_PROVIDER_SECRET not configured. Set it in .env before linking provider accounts.`
   - Derive a 32-byte key with `crypto.createHash("sha256").update(secret).digest()`.
   - Use `aes-256-gcm` with a fresh 12-byte random IV per encryption.
   - Store `ciphertext`, `iv`, and `tag` as base64 strings.
   - Never log plaintext tokens or decrypted values.

### 5. Implement provider clients and sync orchestration

1. Create `server/services/account-linking.ts` with these exported types/functions:
   ```ts
   export type AccountLinkProvider = "plaid" | "akoya";
   export type TargetInstitution = "us_bank" | "discover" | "fidelity";
   export type ProviderConnectionStatus = "active" | "needs_reauth" | "error" | "revoked";

   export interface ProviderConnectionSummary {
     id: string;
     provider: AccountLinkProvider;
     target_institution: TargetInstitution;
     institution_id: string | null;
     institution_name: string;
     status: ProviderConnectionStatus;
     last_sync_at: string | null;
     last_error: string | null;
     accounts: ProviderAccountSummary[];
     created_at: string;
     updated_at: string;
   }

   export interface ProviderAccountSummary {
     id: string;
     local_account_id: string;
     provider_account_id: string;
     name: string;
     mask: string | null;
     type: "asset" | "liability";
     provider_type: string | null;
     provider_subtype: string | null;
     current_balance: number | null;
     available_balance: number | null;
     iso_currency_code: string | null;
     last_balance_at: string | null;
   }

   export interface PlaidLinkTokenResult { link_token: string; expiration: string | null; }
   export interface AkoyaAuthorizationResult { authorizationUrl: string; state: string; }
   export interface ProviderSyncResult {
     connectionId: string;
     provider: AccountLinkProvider;
     accountsUpserted: number;
     transactionsAdded: number;
     transactionsUpdated: number;
     transactionsRemoved: number;
     balanceAdjustmentsCreated: number;
     warnings: string[];
     syncedAt: string;
   }

   export function listProviderConnections(): ProviderConnectionSummary[];
   export async function createPlaidLinkToken(targetInstitution: "us_bank" | "discover"): Promise<PlaidLinkTokenResult>;
   export async function exchangePlaidPublicToken(input: { publicToken: string; targetInstitution: "us_bank" | "discover"; metadata: unknown }): Promise<ProviderConnectionSummary>;
   export function createAkoyaAuthorizationUrl(targetInstitution: "fidelity"): AkoyaAuthorizationResult;
   export async function handleAkoyaCallback(input: { code: string; state: string }): Promise<ProviderConnectionSummary>;
   export async function syncProviderConnections(input?: { connectionId?: string }): Promise<ProviderSyncResult[]>;
   export async function disconnectProviderConnection(connectionId: string): Promise<void>;
   ```
2. Create `server/services/providers/plaid-client.ts` as the only module that imports from `plaid`. Export `createPlaidLinkToken`, `exchangePublicToken`, `getBalances`, `syncTransactions`, and `removeItem`; `server/services/account-linking.ts` must call this adapter so tests can mock provider behavior without mocking the Plaid SDK.
3. Create `server/services/providers/akoya-client.ts` as the only module that performs Akoya `fetch` calls. Export `exchangeCodeForTokens`, `refreshTokens`, `getBalances`, `getTransactions`, and `revokeToken`; `server/services/account-linking.ts` must call this adapter.
4. Plaid client behavior:
   - Use `plaid` SDK configured from `PLAID_ENV` (`sandbox`, `development`, `production`), `PLAID_CLIENT_ID`, and `PLAID_SECRET`.
   - `createPlaidLinkToken` calls `/link/token/create` with:
     ```ts
     {
       client_name: "LocalFin AI",
       language: "en",
       country_codes: ["US"],
       user: { client_user_id: "localfin-default-user" },
       products: ["transactions"],
       transactions: { days_requested: 90 },
       redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
     }
     ```
   - `exchangePlaidPublicToken` calls `/item/public_token/exchange`, encrypts `access_token`, stores `item_id` as `external_item_id`, stores Plaid Link `metadata.institution.institution_id`/`name` when present, then immediately calls Plaid balance/account retrieval to create provider/local account rows. If metadata lacks institution name, use `"Plaid institution"`.
   - For manual sync, call Plaid `/accounts/balance/get` for account values and `/transactions/sync` for transactions. Use `count: 500`; loop until `has_more` is false; persist `next_cursor` only after all fetched updates are applied locally.
   - If Plaid returns `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, restart the sync loop once from the cursor value that existed before the first page of the failed pagination run. If it fails again, mark the connection `status = 'error'`, store `last_error`, and throw.
5. Akoya client behavior:
   - `createAkoyaAuthorizationUrl("fidelity")` creates a 32-byte random hex `state`, stores it in `provider_oauth_states` with 10-minute expiry, and returns:
     ```text
     {AKOYA_AUTH_BASE_URL}/auth?connector={AKOYA_CONNECTOR}&response_type=code&client_id={AKOYA_CLIENT_ID}&redirect_uri={encodeURIComponent(AKOYA_REDIRECT_URI)}&scope=openid%20offline_access%20profile&state={state}
     ```
   - `handleAkoyaCallback` validates exact state, not expired, not consumed, target `fidelity`; then exchanges the code at `{AKOYA_AUTH_BASE_URL}/token` using `application/x-www-form-urlencoded`, `grant_type=authorization_code`, `redirect_uri=AKOYA_REDIRECT_URI`, `code`, and HTTP Basic Auth with `AKOYA_CLIENT_ID`/`AKOYA_CLIENT_SECRET` as docs require for the initial token request.
   - Store encrypted `id_token` as `encrypted_access_token`, encrypted `refresh_token` as `encrypted_refresh_token`, `akoya_provider_id = AKOYA_PROVIDER_ID`, and `akoya_connector = AKOYA_CONNECTOR`. Institution name is literal `"Fidelity"`.
   - Before every Akoya data sync, refresh tokens at `{AKOYA_AUTH_BASE_URL}/token` with `grant_type=refresh_token`, the latest refresh token, and `client_id`/`client_secret` in the form body, then replace both encrypted tokens with the new token response.
   - Fetch balances from `{AKOYA_API_BASE_URL}/balances/{AKOYA_API_VERSION}/{AKOYA_PROVIDER_ID}?mode=standard` with `Authorization: Bearer {id_token}`.
   - Fetch transactions per provider account from `{AKOYA_API_BASE_URL}/transactions/{AKOYA_API_VERSION}/{AKOYA_PROVIDER_ID}/{accountId}?mode=standard&startTime={utcStart}&endTime={utcEnd}&limit=500&offset={offset}`. Use `utcStart = now minus 90 days at 00:00:00.000Z`, `utcEnd = now`, increment `offset` by `limit` until a page returns fewer than 500 transactions. Akoya has no cursor in the docs found here, so re-read the 90-day window every manual sync and rely on provider transaction IDs for idempotence.
6. Local account mapping:
   - Add internal helper `upsertProviderAccount(connection, providerAccount)`.
   - Map provider account type to LocalFin account type:
     - Plaid `type` `"credit"` or `"loan"` => `"liability"`; all other Plaid types => `"asset"`.
     - Akoya/FDX account categories containing `loan`, `loc`, `lineOfCredit`, `creditCard`, or `liability` => `"liability"`; all deposit, investment, insurance, annuity, brokerage, cash, and unknown Fidelity accounts => `"asset"`.
   - Local account name for new linked accounts: `{institutionName} {providerAccount.name}{mask ? " •" + mask : ""}`. If that name collides with an active account/category/subcategory, append `" (Plaid)"` or `" (Akoya)"`; if it still collides, append `" {last4ProviderAccountId}"`.
   - Create local accounts through the same semantics as `createAccount` but with a service-internal insert so provider account creation can run inside the sync transaction. Use `initial_balance = 0`, mapped `type`, and `color = NULL`.
   - Never delete local accounts when a provider account disappears or a connection is disconnected; soft-delete only `provider_accounts`/`provider_connections` links.
7. Transaction mapping and idempotence:
   - Add pure mapper helpers in new `server/services/provider-mappers.ts` and import them from `server/services/account-linking.ts`:
     ```ts
     export function mapPlaidTransactionToLocal(input: { transaction: PlaidTransaction; accountType: AccountType }): ProviderTransactionDraft;
     export function mapAkoyaTransactionToLocal(input: { transaction: AkoyaTransaction; accountType: AccountType; providerAccountId: string }): ProviderTransactionDraft;
     ```
   - `ProviderTransactionDraft` fields: `provider`, `provider_account_id`, `provider_transaction_id`, `provider_pending_transaction_id`, `date` (`YYYY-MM-DD`), `name`, `amount`, `kind`, `comment`.
   - Plaid sign rule: Plaid positive amounts are outflows and negative amounts are inflows. For LocalFin asset accounts, use signed amount `-plaid.amount`; for LocalFin liability accounts, use signed amount `plaid.amount`. Then infer `kind` with `inferTransactionKindForAccount` and insert/update through the same normalization rules as existing transactions.
   - Akoya sign rule: if FDX `debitCreditMemo` or equivalent is present, `DEBIT` means money out and `CREDIT` means money in for assets; for liabilities, invert the economic effect so charges increase debt and payments decrease debt. If Akoya only returns a signed amount, treat positive as outflow and negative as inflow, matching Plaid's convention before applying the asset/liability rule.
   - Transaction name priority: merchant/name/description from provider, first non-empty trimmed string; fallback `"Provider transaction"`.
   - Provider transaction ID priority: provider transaction ID; if absent, SHA-256 hash of `{provider}:{providerAccountId}:{date}:{name}:{amount}`. Store the fallback hash in `provider_transaction_id` so repeated syncs are idempotent.
   - Insert new provider transactions with `subcategory_id = NULL`, `comment = NULL`, `ai_suggested = 0`, and `kind` inferred from signed amount/account type; do not auto-classify provider transactions as `transfer`, and do not run AI categorization during provider sync.
   - On modified/changed provider transactions, update `date`, `name`, `amount`, `kind`, `account_id`, `provider_pending_transaction_id`, and `provider_synced_at`; preserve any user-edited `subcategory_id`, `comment`, and `ai_suggested`.
   - On Plaid `removed` transactions, soft-delete matching provider transactions by setting `deleted_at` and `updated_at`. Akoya sync must not soft-delete transactions missing from a 90-day re-read, because the docs found here do not provide a removed-transaction feed.
8. Balance/account-value sync:
   - After applying provider transactions in the same DB transaction, reconcile each linked local account to the provider current balance.
   - Compute `delta = providerCurrentBalance - (local initial_balance + SUM(non-deleted local transactions.amount))` after transaction upserts/removals.
   - If `Math.round(delta * 100) / 100 === 0`, create no adjustment.
   - Otherwise insert a `transactions` row with `kind = 'adjustment'`, `subcategory_id = NULL`, `ai_suggested = 0`, provider identity fields set to the connection/account, `date = today YYYY-MM-DD`, `name = 'Provider balance sync'`, `amount = delta`, and `comment = '{Plaid|Akoya} balance sync for {institutionName}'`.
   - This preserves the existing account-balance model and keeps dashboard/category spending unaffected because adjustment transactions are excluded from income/expense aggregations.
9. Sync transaction boundary:
   - Do all network fetches before opening a SQLite transaction.
   - Apply account upserts, transaction upserts/removals, balance adjustments, connection cursor/token/status updates, and `last_sync_at` in one `db.transaction` per provider connection.
   - On any local DB error, roll back the whole connection sync and leave `transactions_cursor` unchanged.

### 6. Add account-linking HTTP routes

1. Create `server/routes/account-linking.ts` exporting `accountLinkingRouter`.
2. Use Zod schemas and `parseRequest` from `server/routes/validation.ts`; follow existing route response envelopes.
3. Implement these exact routes:
   - `GET /connections` -> `listProviderConnections`; response `ProviderConnectionSummary[]`.
   - `POST /plaid/link-token` body `{ targetInstitution: "us_bank" | "discover" }` -> `createPlaidLinkToken`; response `PlaidLinkTokenResult`.
   - `POST /plaid/exchange` body `{ publicToken: string; targetInstitution: "us_bank" | "discover"; metadata: unknown }` -> `exchangePlaidPublicToken`; response `ProviderConnectionSummary`; status 201.
   - `POST /akoya/authorize` body `{ targetInstitution: "fidelity" }` -> `createAkoyaAuthorizationUrl`; response `AkoyaAuthorizationResult`; status 201.
   - `GET /akoya/callback` query `{ code: string; state: string; error?: string }` -> if `error` exists, redirect to `${FRONTEND_BASE_URL}/setup?provider=akoya&status=error&message=${encodeURIComponent(error)}`; otherwise call `handleAkoyaCallback` and redirect to `${FRONTEND_BASE_URL}/setup?provider=akoya&status=connected`. This callback is intentionally an HTML redirect, not a JSON API response, because Akoya redirects the browser here.
   - `POST /sync` body `{ connectionId?: string }` -> if `connectionId` is present sync only that active connection; otherwise sync all active connections; response `ProviderSyncResult[]`; status 201.
   - `DELETE /connections/:id` -> revoke/remove upstream access and soft-delete the local connection/link rows; response `{ success: true }`. For Plaid call `/item/remove` before soft delete. For Akoya call `{AKOYA_AUTH_BASE_URL}/revoke` with `application/x-www-form-urlencoded` body `client_id`, `client_secret`, `token` equal to the decrypted refresh token, and `token_type_hint=refresh_token`; if Akoya returns 404/501, still soft-delete locally and include no token values in errors.
4. Error handling:
   - Missing provider env vars throw clear messages naming the env var.
   - Provider non-OK responses include status and provider error text in server error messages, but redact access/refresh/id tokens before throwing.
   - A missing/soft-deleted connection ID returns 404 from the route.

### 7. Add frontend types, hooks, and query keys

1. In `src/types/index.ts`, add the provider types matching the backend response contract:
   ```ts
   export type AccountLinkProvider = "plaid" | "akoya";
   export type TargetInstitution = "us_bank" | "discover" | "fidelity";
   export type ProviderConnectionStatus =
     | "active"
     | "needs_reauth"
     | "error"
     | "revoked";

   export interface ProviderAccountSummary {
     id: string;
     local_account_id: string;
     provider_account_id: string;
     name: string;
     mask: string | null;
     type: AccountType;
     provider_type: string | null;
     provider_subtype: string | null;
     current_balance: number | null;
     available_balance: number | null;
     iso_currency_code: string | null;
     last_balance_at: string | null;
   }

   export interface ProviderConnectionSummary {
     id: string;
     provider: AccountLinkProvider;
     target_institution: TargetInstitution;
     institution_id: string | null;
     institution_name: string;
     status: ProviderConnectionStatus;
     last_sync_at: string | null;
     last_error: string | null;
     accounts: ProviderAccountSummary[];
     created_at: string;
     updated_at: string;
   }

   export interface PlaidLinkTokenResult {
     link_token: string;
     expiration: string | null;
   }

   export interface AkoyaAuthorizationResult {
     authorizationUrl: string;
     state: string;
   }

   export interface ProviderSyncResult {
     connectionId: string;
     provider: AccountLinkProvider;
     accountsUpserted: number;
     transactionsAdded: number;
     transactionsUpdated: number;
     transactionsRemoved: number;
     balanceAdjustmentsCreated: number;
     warnings: string[];
     syncedAt: string;
   }
   ```
2. In `src/lib/queryKeys.ts`, add:
   ```ts
   accountLinking: {
     all: ["account-linking"] as const,
     connections: () => ["account-linking", "connections"] as const,
   }
   ```
3. Create `src/hooks/useAccountLinking.ts`:
   - `connectionsQuery`: `apiGet<ProviderConnectionSummary[]>("/account-linking/connections")`, `select: res.data ?? []`.
   - `createPlaidLinkToken`: mutation posting to `"/account-linking/plaid/link-token"`.
   - `exchangePlaidPublicToken`: mutation posting to `"/account-linking/plaid/exchange"`; on success invalidate `queryKeys.accountLinking.all`, `queryKeys.accounts.all`, `queryKeys.transactions.all`, and `queryKeys.dashboard.all`.
   - `startAkoyaAuthorization`: mutation posting to `"/account-linking/akoya/authorize"`.
   - `syncProviderConnections`: mutation posting to `"/account-linking/sync"`; on success invalidate the same four query groups.
   - `disconnectProviderConnection`: mutation deleting `"/account-linking/connections/${id}"`; on success invalidate the same four query groups.
4. Keep provider hooks separate from `useAccounts`; do not put Plaid/Akoya logic directly inside existing account CRUD hooks.

### 8. Add account-linking UI in Setup

1. In `src/pages/SetupPage.tsx`, inside `AccountsSection`, use `useAccountLinking()` alongside `useAccounts()`.
2. Add a provider card above the accounts table and below the top account-management toolbar. Reuse `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Button`, `Modal`, and `toast` patterns already in the file.
3. The provider card must show three primary connect actions:
   - `Connect US Bank (Plaid)` -> targetInstitution `"us_bank"`.
   - `Connect Discover (Plaid)` -> targetInstitution `"discover"`.
   - `Connect Fidelity (Akoya)` -> targetInstitution `"fidelity"`.
4. Plaid frontend flow:
   - Add a small internal `PlaidConnectButton` component in `SetupPage.tsx` or `src/components/features/PlaidConnectButton.tsx` if the component exceeds about 80 lines.
   - On click, call `createPlaidLinkToken.mutateAsync({ targetInstitution })`.
   - Initialize `usePlaidLink` with the returned `link_token`.
   - Set `receivedRedirectUri: window.location.href` only when `window.location.href.includes("oauth_state_id")`; otherwise omit it.
   - `onSuccess(public_token, metadata)` calls `exchangePlaidPublicToken.mutateAsync({ publicToken: public_token, targetInstitution, metadata })`, then shows `toast.success("Plaid account connected")`.
   - `onExit(error)` shows `toast.error(error.display_message || error.error_message || "Plaid Link exited")` only when `error` exists; no toast for user-cancel without error.
5. Akoya frontend flow:
   - On `Connect Fidelity (Akoya)`, call `startAkoyaAuthorization.mutateAsync({ targetInstitution: "fidelity" })` and then set `window.location.href = result.data.authorizationUrl`.
   - On `SetupPage` mount, if `window.location.search` has `provider=akoya&status=connected`, show `toast.success("Akoya account connected")` and remove those query params with `window.history.replaceState(null, "", "/setup")`.
   - If `status=error`, show `toast.error(message || "Akoya connection failed")` and remove query params the same way.
6. Connection list UI:
   - For each `ProviderConnectionSummary`, show institution name, provider badge, status, last sync time, linked account names/masks/current balances, and last error if present.
   - Add `Sync now` button per connection calling `syncProviderConnections.mutateAsync({ connectionId: connection.id })`.
   - Add `Disconnect` button opening `ConfirmDeleteModal`; confirmation calls `disconnectProviderConnection.mutateAsync(connection.id)`. Modal copy: `Disconnect {institution_name}? Local accounts and imported transactions will remain, but LocalFin will stop syncing this provider connection.`
   - If there are no connections, show `No linked providers yet.`

### 9. Add manual provider sync entry point on Add Transactions

1. In `src/pages/TransactionInputPage.tsx`, import `useAccountLinking`, `Button`, and `Card` components.
2. Insert a compact `Card` between the `<h1>` and `<RecentAccountTransactionsTable />`.
3. Card behavior:
   - If no active connections, text: `Link Plaid or Akoya accounts in Setup to sync transactions from providers instead of pasting statements.` Include a `Setup` link using React Router to `/setup`.
   - If active connections exist, show `Sync linked accounts` button calling `syncProviderConnections.mutateAsync({})` with no `connectionId`, which syncs all active connections.
   - Success toast: `Synced {accounts} account(s), added {added} transaction(s), updated {updated}, removed {removed}.` Aggregate counts from `ProviderSyncResult[]`.
   - Error toast uses the thrown error message.
4. Do not populate `MultiTransactionTable` rows from provider sync. Provider sync writes directly to SQLite and invalidates transactions/dashboard/accounts; manual table remains for pasted/typed/statement imports.

### 10. Tests

1. Add pure mapper tests in new `server/provider-mappers.test.ts`:
   - Plaid asset debit: Plaid amount `12.34`, asset account -> LocalFin amount `-12.34`, kind `expense`.
   - Plaid asset credit: Plaid amount `-25`, asset account -> LocalFin amount `25`, kind `income`.
   - Plaid liability charge: Plaid amount `44.5`, liability account -> LocalFin amount `44.5`, kind `expense`.
   - Plaid liability payment: Plaid amount `-100`, liability account -> LocalFin amount `-100`, kind `income`.
   - Akoya transaction with missing transaction ID gets deterministic SHA-256 fallback ID for identical input.
   - Account type mapping: Plaid `credit` -> liability, Plaid `depository` -> asset, Akoya investment/Fidelity account -> asset.
2. Add service integration tests in `server/provider-sync.test.ts` using existing temp DB pattern from `server/core-invariants.test.ts`:
   - Set `LOCALFIN_DB_PATH` to a temp file and call `closeDbForTests()` before/after each test.
   - Set `LOCALFIN_PROVIDER_SECRET` to a deterministic 32+ char test value.
   - Mock `globalThis.fetch` for Akoya. Wrap Plaid SDK calls in `server/services/providers/plaid-client.ts` (`createPlaidLinkToken`, `exchangePublicToken`, `getBalances`, `syncTransactions`, `removeItem`) and mock that adapter in service tests instead of mocking the Plaid SDK directly.
   - Test linking creates `provider_connections`, `provider_accounts`, local `accounts`, and no plaintext token appears in SQLite token columns.
   - Test first Plaid sync inserts two transactions, stores cursor, creates/updates a balance adjustment to match provider current balance, and returns counts.
   - Test repeating the same sync does not duplicate transactions or balance adjustments when provider balance and transactions are unchanged.
   - Test Plaid removed transaction soft-deletes the matching local provider transaction without deleting local accounts.
   - Test Akoya 401 after refresh sets connection `needs_reauth` and preserves existing local accounts/transactions.
3. Add route smoke tests in `server/account-linking-routes.test.ts` after `createApp` exists:
   - Start `createApp()` on an ephemeral local port with a temp DB and no provider credentials.
   - `GET /api/account-linking/connections` returns `200` and `{ success: true, data: [] }`.
   - `POST /api/account-linking/plaid/link-token` with `{ targetInstitution: "fidelity" }` returns `400` validation failure before any Plaid env lookup.
   - Do not add Supertest; use Node's built-in HTTP server and `fetch`.

### 11. Verification

1. Static and automated checks from repo root after implementation:
   ```powershell
   npm run lint
   npm run typecheck
   node --import tsx --test server/provider-mappers.test.ts server/provider-sync.test.ts server/account-linking-routes.test.ts
   npm test
   ```
   `npm run typecheck` may write TypeScript build info under `node_modules/.tmp`; that is acceptable during implementation verification.
2. Plaid sandbox manual smoke from repo root:
   - Configure `.env` with Plaid sandbox credentials, `PLAID_ENV=sandbox`, `PLAID_REDIRECT_URI=http://localhost:5173/setup`, and `LOCALFIN_PROVIDER_SECRET`.
   - Start with a disposable DB:
     ```powershell
     $env:LOCALFIN_DB_PATH="$env:TEMP\localfin-provider-smoke.db"; npm run dev
     ```
   - Open `http://localhost:5173/setup`.
   - Click `Connect US Bank (Plaid)` or `Connect Discover (Plaid)`, complete Plaid sandbox Link, and confirm the Setup provider card shows an active Plaid connection with linked accounts.
   - Click `Sync now`; expected observable result: linked local accounts exist in the Accounts table, Transaction History contains provider transactions, account current balances match provider balance after a `Provider balance sync` adjustment if needed, and rerunning `Sync now` does not create duplicates.
3. Akoya sandbox manual smoke from repo root:
   - Configure `.env` with Akoya sandbox credentials, `AKOYA_AUTH_BASE_URL=https://sandbox-idp.ddp.akoya.com`, `AKOYA_API_BASE_URL=https://sandbox-products.ddp.akoya.com`, `AKOYA_CONNECTOR=mikomo`, `AKOYA_PROVIDER_ID=mikomo`, `AKOYA_API_VERSION=v3`, `AKOYA_REDIRECT_URI=http://localhost:3001/api/account-linking/akoya/callback`, and `LOCALFIN_PROVIDER_SECRET`.
   - Start with the same disposable DB command above.
   - Open `http://localhost:5173/setup`, click `Connect Fidelity (Akoya)`; in sandbox this uses Mikomo because Fidelity production identifiers are not public.
   - Complete the Akoya sandbox flow; expected observable result: browser returns to `/setup`, toast says Akoya connected, provider card shows active Akoya connection, `Sync now` imports accounts/transactions, and rerunning sync is idempotent.
4. Add Transactions manual sync smoke:
   - With at least one active provider connection, open `http://localhost:5173/transactions/input`.
   - Click `Sync linked accounts`.
   - Expected observable result: toast shows aggregated added/updated/removed counts; Recent Activity and Transaction History reflect newly imported transactions without using the paste/statement table.

## Critical files & anchors

- `server/db/schema.sql` (`accounts` lines 1-12, `transactions` lines 41-61): add provider tables and transaction provider identity columns/indexes without changing existing account/transaction semantics.
- `server/db/index.ts` (`migrate(database)` lines 208-247): add idempotent migrations for new transaction columns and provider tables so existing `data/budget.db` upgrades safely.
- `server/services/transactions.ts` (`createTransaction` lines 227-260, `bulkCreateTransactions` lines 680-731): provider sync should preserve the same sign/kind normalization semantics; use or mirror these inserts inside a provider-sync transaction.
- `src/pages/SetupPage.tsx` (`AccountsSection` lines 154-728, `ReconcileAccountModal` lines 730-819): add provider linking/status/sync/disconnect UI here and copy existing modal/toast/button patterns.
- `src/hooks/useAccounts.ts` lines 11-61 and `src/lib/queryKeys.ts` lines 1-66: copy the existing TanStack Query mutation/invalidation style for provider linking and sync.

## Assumptions & contingencies

- Manual sync only is intentional: do not add a scheduler, webhook listener, or app-start sync in this implementation.
- Akoya Fidelity production identifiers are not publicly documented. Implement with env-driven `AKOYA_CONNECTOR` and `AKOYA_PROVIDER_ID`; sandbox defaults use `mikomo`. If the Data Recipient Hub values differ from any expected naming, no code change is needed because env controls both the OAuth connector and data provider ID.
- If Plaid `accounts/balance/get` is not enabled for the Plaid account, surface the provider error in the sync result and keep transactions/account links intact; do not silently fall back to stale balances because the requested feature includes account values.
- If provider balances are absent/null for a given account, sync transactions for that account but skip the balance adjustment and include a warning in `ProviderSyncResult.warnings`.
- If `LOCALFIN_PROVIDER_SECRET` changes after credentials are stored, decryption will fail. On decryption failure, mark the connection `status = 'error'`, store `last_error = 'Provider credentials could not be decrypted; restore the original LOCALFIN_PROVIDER_SECRET or reconnect the account.'`, and do not delete local data.
- Imported provider transactions remain editable for category/comment cleanup, but provider sync owns date/name/amount/kind for those rows and may overwrite those fields on modified provider transactions.
