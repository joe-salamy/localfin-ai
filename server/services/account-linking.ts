import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { ENV_KEYS, PROVIDER_CONFIG } from "../config/app.js";
import { getDb } from "../db/index.js";
import { decryptSecret, encryptSecret } from "./secret-encryption.js";
import {
  mapAkoyaAccountTypeToLocal,
  mapAkoyaTransactionToLocal,
  mapPlaidAccountTypeToLocal,
  mapPlaidTransactionToLocal,
  type AkoyaTransaction,
  type PlaidTransaction,
  type ProviderTransactionDraft,
} from "./provider-mappers.js";
import * as akoyaClient from "./providers/akoya-client.js";
import * as plaidClient from "./providers/plaid-client.js";
import type { AccountType } from "../../src/types/index.js";

type PlaidProviderClient = typeof plaidClient;
type AkoyaProviderClient = typeof akoyaClient;

let plaidProviderClient: PlaidProviderClient = plaidClient;
let akoyaProviderClient: AkoyaProviderClient = akoyaClient;

export function setProviderClientsForTests(clients: {
  plaid?: Partial<Record<keyof PlaidProviderClient, unknown>>;
  akoya?: Partial<Record<keyof AkoyaProviderClient, unknown>>;
}): () => void {
  const previousPlaid = plaidProviderClient;
  const previousAkoya = akoyaProviderClient;
  plaidProviderClient = { ...plaidClient, ...clients.plaid } as PlaidProviderClient;
  akoyaProviderClient = { ...akoyaClient, ...clients.akoya } as AkoyaProviderClient;
  return () => {
    plaidProviderClient = previousPlaid;
    akoyaProviderClient = previousAkoya;
  };
}

export type AccountLinkProvider = "plaid" | "akoya";
export type TargetInstitution = "us_bank" | "discover" | "fidelity";
export type ProviderConnectionStatus =
  | "active"
  | "needs_reauth"
  | "error"
  | "revoked";

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

interface ProviderConnectionRow {
  id: string;
  provider: AccountLinkProvider;
  target_institution: TargetInstitution;
  institution_id: string | null;
  institution_name: string;
  external_item_id: string | null;
  akoya_provider_id: string | null;
  akoya_connector: string | null;
  encrypted_access_token: string;
  access_token_iv: string;
  access_token_tag: string;
  encrypted_refresh_token: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  transactions_cursor: string | null;
  status: ProviderConnectionStatus;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ProviderAccountRow extends ProviderAccountSummary {
  connection_id: string;
  official_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
}

interface BalanceRow {
  balance: number | null;
}

interface TransactionIdRow {
  id: string;
}


interface ProviderAccountDraft {
  providerAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: AccountType;
  providerType: string | null;
  providerSubtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  isoCurrencyCode: string | null;
  raw: unknown;
}

interface NetworkPayload {
  accounts: ProviderAccountDraft[];
  added: unknown[];
  modified: unknown[];
  removedIds: string[];
  nextCursor: string | null;
  refreshedAccessToken?: string;
  refreshedRefreshToken?: string;
}

interface ApplyCounts {
  accountsUpserted: number;
  transactionsAdded: number;
  transactionsUpdated: number;
  transactionsRemoved: number;
  balanceAdjustmentsCreated: number;
}

const PLAID_TARGETS = new Set<TargetInstitution>(["us_bank", "discover"]);
const AKOYA_TARGETS = new Set<TargetInstitution>(["fidelity"]);

function nowIso() {
  return new Date().toISOString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function roundCurrency(amount: number) {
  return Math.round(amount * 100) / 100;
}

function requireEnv(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown, key: string): string | null {
  const record = readRecord(value);
  if (!record) return null;
  const field = record[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function readNumber(value: unknown, key: string): number | null {
  const record = readRecord(value);
  if (!record) return null;
  const field = record[key];
  if (field === null || field === undefined || field === "") return null;
  const numberValue = typeof field === "number" ? field : Number(field);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readArray(value: unknown, key: string): unknown[] {
  const record = readRecord(value);
  if (!record) return [];
  const field = record[key];
  return Array.isArray(field) ? field : [];
}

function encryptedColumns(plaintext: string) {
  const encrypted = encryptSecret(plaintext);
  return [encrypted.ciphertext, encrypted.iv, encrypted.tag] as const;
}

function decryptAccessToken(connection: ProviderConnectionRow) {
  try {
    return decryptSecret({
      ciphertext: connection.encrypted_access_token,
      iv: connection.access_token_iv,
      tag: connection.access_token_tag,
    });
  } catch {
    markConnectionError(
      connection.id,
      "Provider credentials could not be decrypted; restore the original LOCALFIN_PROVIDER_SECRET or reconnect the account.",
      "error",
    );
    throw new Error(
      "Provider credentials could not be decrypted; restore the original LOCALFIN_PROVIDER_SECRET or reconnect the account.",
    );
  }
}

function decryptRefreshToken(connection: ProviderConnectionRow) {
  if (
    !connection.encrypted_refresh_token ||
    !connection.refresh_token_iv ||
    !connection.refresh_token_tag
  ) {
    throw new Error("Akoya refresh token is missing; reconnect the account.");
  }

  try {
    return decryptSecret({
      ciphertext: connection.encrypted_refresh_token,
      iv: connection.refresh_token_iv,
      tag: connection.refresh_token_tag,
    });
  } catch {
    markConnectionError(
      connection.id,
      "Provider credentials could not be decrypted; restore the original LOCALFIN_PROVIDER_SECRET or reconnect the account.",
      "error",
    );
    throw new Error(
      "Provider credentials could not be decrypted; restore the original LOCALFIN_PROVIDER_SECRET or reconnect the account.",
    );
  }
}

function connectionSummaryFromRow(
  row: ProviderConnectionRow,
  accounts: ProviderAccountSummary[],
): ProviderConnectionSummary {
  return {
    id: row.id,
    provider: row.provider,
    target_institution: row.target_institution,
    institution_id: row.institution_id,
    institution_name: row.institution_name,
    status: row.status,
    last_sync_at: row.last_sync_at,
    last_error: row.last_error,
    accounts,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function providerAccountSummaryFromRow(row: ProviderAccountRow): ProviderAccountSummary {
  return {
    id: row.id,
    local_account_id: row.local_account_id,
    provider_account_id: row.provider_account_id,
    name: row.name,
    mask: row.mask,
    type: row.type,
    provider_type: row.provider_type,
    provider_subtype: row.provider_subtype,
    current_balance: row.current_balance,
    available_balance: row.available_balance,
    iso_currency_code: row.iso_currency_code,
    last_balance_at: row.last_balance_at,
  };
}

function getProviderAccounts(
  db: Database.Database,
  connectionId: string,
): ProviderAccountSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM provider_accounts
       WHERE connection_id = ? AND deleted_at IS NULL
       ORDER BY created_at`,
    )
    .all(connectionId) as ProviderAccountRow[];
  return rows.map(providerAccountSummaryFromRow);
}

function getConnectionById(connectionId: string): ProviderConnectionRow | undefined {
  const row = getDb()
    .prepare(
      `SELECT * FROM provider_connections
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(connectionId) as ProviderConnectionRow | undefined;
  return row;
}

function markConnectionError(
  connectionId: string,
  message: string,
  status: ProviderConnectionStatus,
) {
  getDb()
    .prepare(
      `UPDATE provider_connections
       SET status = ?, last_error = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(status, message, nowIso(), connectionId);
}

function inferInstitutionFromPlaidMetadata(metadata: unknown) {
  const metadataRecord = readRecord(metadata);
  const institution = metadataRecord ? metadataRecord.institution : null;
  return {
    institutionId: readString(institution, "institution_id"),
    institutionName: readString(institution, "name") ?? "Plaid institution",
  };
}


function normalizePlaidAccounts(response: unknown): ProviderAccountDraft[] {
  const accounts = Array.isArray(response) ? response : readArray(response, "accounts");
  return accounts
    .map((account) => {
      const balances = readRecord(account)?.balances;
      const providerType = readString(account, "type");
      const providerAccountId = readString(account, "account_id");
      const name = readString(account, "name");
      if (!providerAccountId || !name) return null;
      return {
        providerAccountId,
        name,
        officialName: readString(account, "official_name"),
        mask: readString(account, "mask"),
        type: mapPlaidAccountTypeToLocal(providerType),
        providerType,
        providerSubtype: readString(account, "subtype"),
        currentBalance: readNumber(balances, "current"),
        availableBalance: readNumber(balances, "available"),
        isoCurrencyCode: readString(balances, "iso_currency_code"),
        raw: account,
      };
    })
    .filter((account): account is ProviderAccountDraft => account !== null);
}

function normalizeAkoyaAccounts(response: unknown): ProviderAccountDraft[] {
  const candidateArrays = [
    readArray(response, "accounts"),
    readArray(response, "depositAccounts"),
    readArray(response, "investmentAccounts"),
    readArray(response, "loanAccounts"),
    readArray(response, "lineOfCreditAccounts"),
  ];
  const accounts = candidateArrays.flat();
  return accounts
    .map((account): ProviderAccountDraft | null => {
      const providerAccountId =
        readString(account, "accountId") ?? readString(account, "account_id");
      const name =
        readString(account, "nickname") ??
        readString(account, "displayName") ??
        readString(account, "name") ??
        readString(account, "accountType");
      if (!providerAccountId || !name) return null;
      const category =
        readString(account, "category") ??
        readString(account, "accountCategory") ??
        readString(account, "accountType");
      return {
        providerAccountId,
        name,
        officialName: readString(account, "description"),
        mask:
          readString(account, "accountNumberDisplay") ??
          readString(account, "accountNumberMasked") ??
          readString(account, "mask"),
        type: mapAkoyaAccountTypeToLocal(category),
        providerType: category,
        providerSubtype: readString(account, "accountType"),
        currentBalance:
          readNumber(account, "currentBalance") ??
          readNumber(account, "balance") ??
          readNumber(account, "marketValue"),
        availableBalance: readNumber(account, "availableBalance"),
        isoCurrencyCode: readString(account, "currency") ?? "USD",
        raw: account,
      };
    })
    .filter((account): account is ProviderAccountDraft => account !== null);
}

function transactionArrays(response: unknown) {
  if (Array.isArray(response)) return response;
  return [
    ...readArray(response, "transactions"),
    ...readArray(response, "depositTransactions"),
    ...readArray(response, "investmentTransactions"),
    ...readArray(response, "loanTransactions"),
    ...readArray(response, "lineOfCreditTransactions"),
  ];
}

function resolveUniqueAccountName(
  db: Database.Database,
  baseName: string,
  provider: AccountLinkProvider,
  providerAccountId: string,
) {
  const providerLabel = provider === "plaid" ? "Plaid" : "Akoya";
  const suffix = providerAccountId.slice(-4) || crypto.randomUUID().slice(0, 4);
  const candidates = [baseName, `${baseName} (${providerLabel})`, `${baseName} ${suffix}`];

  for (const candidate of candidates) {
    const accountExists = db
      .prepare("SELECT 1 FROM accounts WHERE name = ? AND deleted_at IS NULL")
      .get(candidate);
    const categoryExists = db
      .prepare("SELECT 1 FROM categories WHERE name = ? AND deleted_at IS NULL")
      .get(candidate);
    const subcategoryExists = db
      .prepare("SELECT 1 FROM subcategories WHERE name = ? AND deleted_at IS NULL")
      .get(candidate);
    if (!accountExists && !categoryExists && !subcategoryExists) return candidate;
  }

  throw new Error(`Could not create a unique account name for ${baseName}`);
}

function createLinkedLocalAccount(
  db: Database.Database,
  connection: ProviderConnectionRow,
  account: ProviderAccountDraft,
) {
  const name = `${connection.institution_name} ${account.name}${
    account.mask ? ` •${account.mask}` : ""
  }`;
  const accountId = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO accounts (id, name, type, initial_balance, color, created_at, updated_at)
     VALUES (?, ?, ?, 0, NULL, ?, ?)`,
  ).run(
    accountId,
    resolveUniqueAccountName(db, name, connection.provider, account.providerAccountId),
    account.type,
    timestamp,
    timestamp,
  );
  return accountId;
}

function upsertProviderAccount(
  db: Database.Database,
  connection: ProviderConnectionRow,
  account: ProviderAccountDraft,
) {
  const existing = db
    .prepare(
      `SELECT * FROM provider_accounts
       WHERE connection_id = ? AND provider_account_id = ? AND deleted_at IS NULL`,
    )
    .get(connection.id, account.providerAccountId) as ProviderAccountRow | undefined;
  const timestamp = nowIso();
  const lastBalanceAt = account.currentBalance === null ? null : timestamp;

  if (existing) {
    db.prepare(
      `UPDATE provider_accounts
       SET name = ?, official_name = ?, mask = ?, type = ?, provider_type = ?,
           provider_subtype = ?, current_balance = ?, available_balance = ?,
           iso_currency_code = ?, last_balance_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      account.name,
      account.officialName,
      account.mask,
      account.type,
      account.providerType,
      account.providerSubtype,
      account.currentBalance,
      account.availableBalance,
      account.isoCurrencyCode,
      lastBalanceAt,
      timestamp,
      existing.id,
    );
    return existing.local_account_id;
  }

  const localAccountId = createLinkedLocalAccount(db, connection, account);
  db.prepare(
    `INSERT INTO provider_accounts (
       id, connection_id, local_account_id, provider_account_id, name,
       official_name, mask, type, provider_type, provider_subtype,
       current_balance, available_balance, iso_currency_code, last_balance_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    connection.id,
    localAccountId,
    account.providerAccountId,
    account.name,
    account.officialName,
    account.mask,
    account.type,
    account.providerType,
    account.providerSubtype,
    account.currentBalance,
    account.availableBalance,
    account.isoCurrencyCode,
    lastBalanceAt,
    timestamp,
    timestamp,
  );
  return localAccountId;
}


function insertProviderTransaction(
  db: Database.Database,
  draft: ProviderTransactionDraft,
  localAccountId: string,
  connectionId: string,
  syncedAt: string,
) {
  const existing = db
    .prepare(
      `SELECT id
       FROM transactions
       WHERE provider = ? AND provider_transaction_id = ? AND deleted_at IS NULL`,
    )
    .get(draft.provider, draft.provider_transaction_id) as TransactionIdRow | undefined;
  if (existing) {
    db.prepare(
      `UPDATE transactions
       SET account_id = ?, date = ?, name = ?, amount = ?, kind = ?,
           provider_pending_transaction_id = ?, provider_synced_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      localAccountId,
      draft.date,
      draft.name,
      draft.amount,
      draft.kind,
      draft.provider_pending_transaction_id,
      syncedAt,
      syncedAt,
      existing.id,
    );
    return "updated" as const;
  }

  db.prepare(
    `INSERT INTO transactions (
       id, account_id, date, name, amount, kind, subcategory_id, comment,
       is_initial_balance, ai_suggested, provider, provider_connection_id,
       provider_account_id, provider_transaction_id, provider_pending_transaction_id,
       provider_synced_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    localAccountId,
    draft.date,
    draft.name,
    draft.amount,
    draft.kind,
    draft.provider,
    connectionId,
    draft.provider_account_id,
    draft.provider_transaction_id,
    draft.provider_pending_transaction_id,
    syncedAt,
    syncedAt,
    syncedAt,
  );
  return "added" as const;
}

function createBalanceAdjustmentIfNeeded(
  db: Database.Database,
  connection: ProviderConnectionRow,
  account: ProviderAccountDraft,
  localAccountId: string,
  syncedAt: string,
  warnings: string[],
) {
  if (account.currentBalance === null) {
    warnings.push(`Missing provider balance for ${account.name}; skipped balance adjustment.`);
    return 0;
  }

  const localAccount = db
    .prepare("SELECT id, name, type, initial_balance FROM accounts WHERE id = ?")
    .get(localAccountId) as AccountRow | undefined;
  if (!localAccount) throw new Error(`Local account ${localAccountId} not found`);

  const balanceRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM transactions
       WHERE account_id = ? AND deleted_at IS NULL`,
    )
    .get(localAccountId) as BalanceRow;
  const localBalance = roundCurrency(
    localAccount.initial_balance + (balanceRow.balance ?? 0),
  );
  const delta = roundCurrency(account.currentBalance - localBalance);
  if (delta === 0) return 0;

  db.prepare(
    `INSERT INTO transactions (
       id, account_id, date, name, amount, kind, subcategory_id, comment,
       is_initial_balance, ai_suggested, provider, provider_connection_id,
       provider_account_id, provider_synced_at, created_at, updated_at
     ) VALUES (?, ?, ?, 'Provider balance sync', ?, 'adjustment', NULL, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    localAccountId,
    todayIsoDate(),
    delta,
    `${connection.provider === "plaid" ? "Plaid" : "Akoya"} balance sync for ${
      connection.institution_name
    }`,
    connection.provider,
    connection.id,
    account.providerAccountId,
    syncedAt,
    syncedAt,
    syncedAt,
  );
  return 1;
}

function applyNetworkPayload(
  connection: ProviderConnectionRow,
  payload: NetworkPayload,
  syncedAt: string,
  warnings: string[],
): ApplyCounts {
  const db = getDb();
  return db.transaction(() => {
    const accountMap = new Map<string, { localAccountId: string; type: AccountType }>();
    let balanceAdjustmentsCreated = 0;

    for (const account of payload.accounts) {
      const localAccountId = upsertProviderAccount(db, connection, account);
      accountMap.set(account.providerAccountId, {
        localAccountId,
        type: account.type,
      });
    }

    let transactionsAdded = 0;
    let transactionsUpdated = 0;
    for (const transaction of [...payload.added, ...payload.modified]) {
      const providerAccountId =
        connection.provider === "plaid"
          ? readString(transaction, "account_id")
          : readString(transaction, "accountId") ?? readString(transaction, "account_id");
      if (!providerAccountId) continue;
      const localAccount = accountMap.get(providerAccountId);
      if (!localAccount) continue;
      const draft =
        connection.provider === "plaid"
          ? mapPlaidTransactionToLocal({
              transaction: transaction as PlaidTransaction,
              accountType: localAccount.type,
            })
          : mapAkoyaTransactionToLocal({
              transaction: transaction as AkoyaTransaction,
              accountType: localAccount.type,
              providerAccountId,
            });
      const result = insertProviderTransaction(
        db,
        draft,
        localAccount.localAccountId,
        connection.id,
        syncedAt,
      );
      if (result === "added") transactionsAdded += 1;
      if (result === "updated") transactionsUpdated += 1;
    }

    let transactionsRemoved = 0;
    for (const removedId of payload.removedIds) {
      const result = db
        .prepare(
          `UPDATE transactions
           SET deleted_at = ?, updated_at = ?
           WHERE provider = ? AND provider_transaction_id = ? AND deleted_at IS NULL`,
        )
        .run(syncedAt, syncedAt, connection.provider, removedId);
      transactionsRemoved += result.changes;
    }

    for (const account of payload.accounts) {
      const localAccount = accountMap.get(account.providerAccountId);
      if (!localAccount) continue;
      balanceAdjustmentsCreated += createBalanceAdjustmentIfNeeded(
        db,
        connection,
        account,
        localAccount.localAccountId,
        syncedAt,
        warnings,
      );
    }

    if (payload.refreshedAccessToken) {
      const [ciphertext, iv, tag] = encryptedColumns(payload.refreshedAccessToken);
      db.prepare(
        `UPDATE provider_connections
         SET encrypted_access_token = ?, access_token_iv = ?, access_token_tag = ?
         WHERE id = ?`,
      ).run(ciphertext, iv, tag, connection.id);
    }
    if (payload.refreshedRefreshToken) {
      const [ciphertext, iv, tag] = encryptedColumns(payload.refreshedRefreshToken);
      db.prepare(
        `UPDATE provider_connections
         SET encrypted_refresh_token = ?, refresh_token_iv = ?, refresh_token_tag = ?
         WHERE id = ?`,
      ).run(ciphertext, iv, tag, connection.id);
    }

    db.prepare(
      `UPDATE provider_connections
       SET transactions_cursor = ?, status = 'active', last_error = NULL,
           last_sync_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(payload.nextCursor, syncedAt, syncedAt, connection.id);

    return {
      accountsUpserted: payload.accounts.length,
      transactionsAdded,
      transactionsUpdated,
      transactionsRemoved,
      balanceAdjustmentsCreated,
    };
  })();
}

async function fetchPlaidPayload(connection: ProviderConnectionRow): Promise<NetworkPayload> {
  const accessToken = decryptAccessToken(connection);
  const balances = await plaidProviderClient.getBalances(accessToken);
  const accounts = normalizePlaidAccounts(balances);
  const startingCursor = connection.transactions_cursor;
  const collectPages = async () => {
    let cursor = startingCursor;
    const added: unknown[] = [];
    const modified: unknown[] = [];
    const removedIds: string[] = [];
    for (;;) {
      const page = await plaidProviderClient.syncTransactions({
        accessToken,
        cursor,
        count: 500,
      });
      added.push(...readArray(page, "added"));
      modified.push(...readArray(page, "modified"));
      for (const removed of readArray(page, "removed")) {
        const removedId = readString(removed, "transaction_id");
        if (removedId) removedIds.push(removedId);
      }
      cursor = readString(page, "next_cursor");
      const pageRecord = readRecord(page);
      const hasMore = pageRecord?.has_more === true;
      if (!hasMore) return { added, modified, removedIds, nextCursor: cursor };
    }
  };

  try {
    const transactions = await collectPages();
    return { accounts, ...transactions };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Plaid error";
    const errorRecord = readRecord(error);
    const errorCode = readString(errorRecord, "error_code") ?? readString(errorRecord, "code");
    if (
      errorCode !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
      !message.includes("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")
    ) {
      throw error;
    }
    try {
      const transactions = await collectPages();
      return { accounts, ...transactions };
    } catch (retryError) {
      const retryMessage =
        retryError instanceof Error ? retryError.message : message;
      markConnectionError(connection.id, retryMessage, "error");
      throw retryError;
    }
  }
}

async function fetchAkoyaPayload(connection: ProviderConnectionRow): Promise<NetworkPayload> {
  const refreshToken = decryptRefreshToken(connection);
  try {
    const refreshed = await akoyaProviderClient.refreshTokens({ refreshToken });
    const refreshedRecord = readRecord(refreshed);
    const idToken =
      readString(refreshedRecord, "id_token") ?? readString(refreshedRecord, "access_token");
    const nextRefreshToken = readString(refreshedRecord, "refresh_token") ?? refreshToken;
    if (!idToken) throw new Error("Akoya refresh response did not include an id_token");

    const akoyaProviderId = connection.akoya_provider_id ?? undefined;
    const balances = await akoyaProviderClient.getBalances({
      idToken,
      providerId: akoyaProviderId,
    });
    const accounts = normalizeAkoyaAccounts(balances);
    const added: unknown[] = [];
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - 90);
    startDate.setUTCHours(0, 0, 0, 0);
    const startTime = startDate.toISOString();
    const endTime = new Date().toISOString();

    for (const account of accounts) {
      let offset = 0;
      const limit = 500;
      for (;;) {
        const page = await akoyaProviderClient.getTransactions({
          idToken,
          accountId: account.providerAccountId,
          startTime,
          endTime,
          limit,
          offset,
          providerId: akoyaProviderId,
        });
        const transactions = transactionArrays(page);
        for (const transaction of transactions) {
          const record = readRecord(transaction);
          added.push(record ? { ...record, accountId: readString(record, "accountId") ?? account.providerAccountId } : transaction);
        }
        if (transactions.length < limit) break;
        offset += limit;
      }
    }

    return {
      accounts,
      added,
      modified: [],
      removedIds: [],
      nextCursor: connection.transactions_cursor,
      refreshedAccessToken: idToken,
      refreshedRefreshToken: nextRefreshToken,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Akoya error";
    const status = readNumber(error, "status");
    if (status === 401 || status === 403 || message.includes("401") || message.includes("403")) {
      markConnectionError(connection.id, message, "needs_reauth");
    }
    throw error;
  }
}

export function listProviderConnections(): ProviderConnectionSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM provider_connections
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all() as ProviderConnectionRow[];
  return rows.map((row) => connectionSummaryFromRow(row, getProviderAccounts(db, row.id)));
}

export async function createPlaidLinkToken(
  targetInstitution: "us_bank" | "discover",
): Promise<PlaidLinkTokenResult> {
  if (!PLAID_TARGETS.has(targetInstitution)) {
    throw new Error("Plaid linking is only supported for US Bank and Discover");
  }
  const result = await plaidProviderClient.createPlaidLinkToken();
  const linkToken = readString(result, "link_token");
  if (!linkToken) throw new Error("Plaid link token response did not include a link_token");
  return {
    link_token: linkToken,
    expiration: readString(result, "expiration"),
  };
}

export async function exchangePlaidPublicToken(input: {
  publicToken: string;
  targetInstitution: "us_bank" | "discover";
  metadata: unknown;
}): Promise<ProviderConnectionSummary> {
  if (!PLAID_TARGETS.has(input.targetInstitution)) {
    throw new Error("Plaid linking is only supported for US Bank and Discover");
  }
  const exchange = await plaidProviderClient.exchangePublicToken(input.publicToken);
  const exchangeRecord = readRecord(exchange);
  const accessToken = readString(exchangeRecord, "access_token") ?? readString(exchangeRecord, "accessToken");
  const itemId = readString(exchangeRecord, "item_id") ?? readString(exchangeRecord, "itemId");
  if (!accessToken || !itemId) {
    throw new Error("Plaid public token exchange did not return an access token and item id");
  }
  const balances = await plaidProviderClient.getBalances(accessToken);
  const accounts = normalizePlaidAccounts(balances);
  const institution = inferInstitutionFromPlaidMetadata(input.metadata);
  const [ciphertext, iv, tag] = encryptedColumns(accessToken);
  const db = getDb();
  const timestamp = nowIso();
  const connectionId = crypto.randomUUID();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO provider_connections (
         id, provider, target_institution, institution_id, institution_name,
         external_item_id, encrypted_access_token, access_token_iv, access_token_tag,
         status, created_at, updated_at
       ) VALUES (?, 'plaid', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      connectionId,
      input.targetInstitution,
      institution.institutionId,
      institution.institutionName,
      itemId,
      ciphertext,
      iv,
      tag,
      timestamp,
      timestamp,
    );
    const connection = db
      .prepare("SELECT * FROM provider_connections WHERE id = ?")
      .get(connectionId) as ProviderConnectionRow;
    for (const account of accounts) {
      upsertProviderAccount(db, connection, account);
    }
  })();

  const created = getConnectionById(connectionId);
  if (!created) throw new Error("Provider connection was not created");
  return connectionSummaryFromRow(created, getProviderAccounts(db, connectionId));
}

export function createAkoyaAuthorizationUrl(
  targetInstitution: "fidelity",
): AkoyaAuthorizationResult {
  if (!AKOYA_TARGETS.has(targetInstitution)) {
    throw new Error("Akoya linking is only supported for Fidelity");
  }
  const clientId = requireEnv(ENV_KEYS.akoyaClientId);
  const redirectUri = requireEnv(ENV_KEYS.akoyaRedirectUri);
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO provider_oauth_states (
         state, provider, target_institution, redirect_after, expires_at
       ) VALUES (?, 'akoya', 'fidelity', ?, ?)`,
    )
    .run(state, redirectUri, expiresAt);
  const authBaseUrl = process.env[ENV_KEYS.akoyaAuthBaseUrl] ?? PROVIDER_CONFIG.akoyaAuthBaseUrl;
  const connector = process.env[ENV_KEYS.akoyaConnector] ?? PROVIDER_CONFIG.akoyaConnector;
  const scope = encodeURIComponent(PROVIDER_CONFIG.akoyaScope);
  const authorizationUrl = `${authBaseUrl}/auth?connector=${encodeURIComponent(
    connector,
  )}&response_type=code&client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
  return { authorizationUrl, state };
}

export async function handleAkoyaCallback(input: {
  code: string;
  state: string;
}): Promise<ProviderConnectionSummary> {
  const db = getDb();
  const stateRow = db
    .prepare(
      `SELECT * FROM provider_oauth_states
       WHERE state = ? AND provider = 'akoya' AND target_institution = 'fidelity'`,
    )
    .get(input.state) as
    | { state: string; expires_at: string; consumed_at: string | null }
    | undefined;
  if (!stateRow || stateRow.consumed_at) throw new Error("Invalid Akoya state");
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    throw new Error("Akoya state expired");
  }

  const redirectUri = requireEnv(ENV_KEYS.akoyaRedirectUri);
  const tokens = await akoyaProviderClient.exchangeCodeForTokens({
    code: input.code,
    redirectUri,
  });
  const tokenRecord = readRecord(tokens);
  const idToken = readString(tokenRecord, "id_token") ?? readString(tokenRecord, "access_token");
  const refreshToken = readString(tokenRecord, "refresh_token");
  if (!idToken || !refreshToken) {
    throw new Error("Akoya token exchange did not return id_token and refresh_token");
  }

  const [accessCiphertext, accessIv, accessTag] = encryptedColumns(idToken);
  const [refreshCiphertext, refreshIv, refreshTag] = encryptedColumns(refreshToken);
  const timestamp = nowIso();
  const connectionId = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(
      `UPDATE provider_oauth_states SET consumed_at = ? WHERE state = ?`,
    ).run(timestamp, input.state);
    db.prepare(
      `INSERT INTO provider_connections (
         id, provider, target_institution, institution_name, akoya_provider_id,
         akoya_connector, encrypted_access_token, access_token_iv, access_token_tag,
         encrypted_refresh_token, refresh_token_iv, refresh_token_tag,
         status, created_at, updated_at
       ) VALUES (?, 'akoya', 'fidelity', 'Fidelity', ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      connectionId,
      process.env[ENV_KEYS.akoyaProviderId] ?? PROVIDER_CONFIG.akoyaProviderId,
      process.env[ENV_KEYS.akoyaConnector] ?? PROVIDER_CONFIG.akoyaConnector,
      accessCiphertext,
      accessIv,
      accessTag,
      refreshCiphertext,
      refreshIv,
      refreshTag,
      timestamp,
      timestamp,
    );
  })();

  const created = getConnectionById(connectionId);
  if (!created) throw new Error("Provider connection was not created");
  return connectionSummaryFromRow(created, getProviderAccounts(db, connectionId));
}

export async function syncProviderConnections(input: { connectionId?: string } = {}): Promise<ProviderSyncResult[]> {
  const db = getDb();
  const connections = input.connectionId
    ? [getConnectionById(input.connectionId)].filter(
        (connection): connection is ProviderConnectionRow => connection !== undefined,
      )
    : (db
        .prepare(
          `SELECT * FROM provider_connections
           WHERE status = 'active' AND deleted_at IS NULL
           ORDER BY created_at`,
        )
        .all() as ProviderConnectionRow[]);

  if (input.connectionId && connections.length === 0) {
    throw new Error(`Provider connection with id "${input.connectionId}" not found`);
  }
  if (input.connectionId && connections[0]?.status !== "active") {
    throw new Error(
      `Provider connection with id "${input.connectionId}" is not active; reconnect the account before syncing`,
    );
  }

  const results: ProviderSyncResult[] = [];
  for (const connection of connections) {
    const warnings: string[] = [];
    const syncedAt = nowIso();
    const payload =
      connection.provider === "plaid"
        ? await fetchPlaidPayload(connection)
        : await fetchAkoyaPayload(connection);
    const counts = applyNetworkPayload(connection, payload, syncedAt, warnings);
    results.push({
      connectionId: connection.id,
      provider: connection.provider,
      ...counts,
      warnings,
      syncedAt,
    });
  }
  return results;
}

export async function disconnectProviderConnection(connectionId: string): Promise<void> {
  const connection = getConnectionById(connectionId);
  if (!connection) {
    throw new Error(`Provider connection with id "${connectionId}" not found`);
  }

  if (connection.provider === "plaid") {
    await plaidProviderClient.removeItem(decryptAccessToken(connection));
  } else {
    try {
      await akoyaProviderClient.revokeToken({ refreshToken: decryptRefreshToken(connection) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Akoya revoke error";
      const status = readNumber(error, "status");
      if (status !== 404 && status !== 501 && !message.includes("404") && !message.includes("501")) {
        throw error;
      }
    }
  }

  const timestamp = nowIso();
  getDb().transaction(() => {
    getDb()
      .prepare(
        `UPDATE provider_accounts
         SET deleted_at = ?, updated_at = ?
         WHERE connection_id = ? AND deleted_at IS NULL`,
      )
      .run(timestamp, timestamp, connectionId);
    getDb()
      .prepare(
        `UPDATE provider_connections
         SET status = 'revoked', deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(timestamp, timestamp, connectionId);
  })();
}
