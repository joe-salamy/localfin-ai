import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "../../db/index.js";
import { BadRequestError } from "../../errors.js";
import {
  decryptSecretWithMigration,
  encryptSecret,
} from "../secret-encryption.js";
import { redactSecrets } from "../providers/redact.js";
import type {
  AccountLinkProvider,
  AccountType,
  ProviderAccountSummary,
  ProviderConnectionStatus,
  ProviderConnectionSummary,
  TargetInstitution,
} from "../../../shared/contracts/index.js";

/** Hard cap on provider pagination pages per sync so an upstream
 *  `has_more`/full-page loop cannot run forever or exhaust memory. */
export const MAX_SYNC_PAGES = 100;

export interface ProviderConnectionRow {
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

export interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
}

export interface BalanceRow {
  balance: number | null;
}

export interface TransactionIdRow {
  id: string;
}

export interface ProviderAccountDraft {
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

export interface NetworkPayload {
  accounts: ProviderAccountDraft[];
  added: unknown[];
  modified: unknown[];
  removedIds: string[];
  nextCursor: string | null;
  refreshedAccessToken?: string;
  refreshedRefreshToken?: string;
}

export interface ApplyCounts {
  accountsUpserted: number;
  transactionsAdded: number;
  transactionsUpdated: number;
  transactionsRemoved: number;
  balanceAdjustmentsCreated: number;
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function roundCurrency(amount: number) {
  return Math.round(amount * 100) / 100;
}

export function requireEnv(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function readString(value: unknown, key: string): string | null {
  const record = readRecord(value);
  if (!record) return null;
  const field = record[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

export function readNumber(value: unknown, key: string): number | null {
  const record = readRecord(value);
  if (!record) return null;
  const field = record[key];
  if (field === null || field === undefined || field === "") return null;
  const numberValue = typeof field === "number" ? field : Number(field);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<object>();
  let current: unknown = error;
  while (isRecord(current) && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = current.cause;
  }
  return chain;
}

export function providerErrorMessage(error: unknown, fallback: string): string {
  const messages = errorChain(error)
    .map((item) => (item instanceof Error ? item.message : readString(item, "message")))
    .filter((message): message is string => Boolean(message));
  return messages.length > 0 ? messages.join(": ") : fallback;
}

export function readArray(value: unknown, key: string): unknown[] {
  const record = readRecord(value);
  if (!record) return [];
  const field = record[key];
  return Array.isArray(field) ? field : [];
}

export function encryptedColumns(plaintext: string) {
  const encrypted = encryptSecret(plaintext);
  return [encrypted.ciphertext, encrypted.iv, encrypted.tag] as const;
}

const DECRYPT_ERROR_MESSAGE =
  "Provider credentials could not be decrypted; restore the original LOCALFIN_PROVIDER_SECRET or reconnect the account.";

function failConnectionDecrypt(connectionId: string): never {
  markConnectionError(connectionId, DECRYPT_ERROR_MESSAGE, "error");
  throw new Error(DECRYPT_ERROR_MESSAGE);
}

export function assertTargetSupported(
  haystack: readonly string[],
  value: string,
  label: string,
): void {
  if (!haystack.includes(value)) {
    throw new BadRequestError(label);
  }
}

export function decryptAccessToken(connection: ProviderConnectionRow) {
  try {
    const { plaintext, migrated } = decryptSecretWithMigration({
      ciphertext: connection.encrypted_access_token,
      iv: connection.access_token_iv,
      tag: connection.access_token_tag,
    });
    if (migrated) {
      const encrypted = encryptSecret(plaintext);
      getDb()
        .prepare(
          `UPDATE provider_connections
           SET encrypted_access_token = ?, access_token_iv = ?, access_token_tag = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag,
          nowIso(),
          connection.id,
        );
    }
    return plaintext;
  } catch {
    failConnectionDecrypt(connection.id);
  }
}

export function decryptRefreshToken(connection: ProviderConnectionRow) {
  if (
    !connection.encrypted_refresh_token ||
    !connection.refresh_token_iv ||
    !connection.refresh_token_tag
  ) {
    throw new Error("Akoya refresh token is missing; reconnect the account.");
  }

  try {
    const { plaintext, migrated } = decryptSecretWithMigration({
      ciphertext: connection.encrypted_refresh_token,
      iv: connection.refresh_token_iv,
      tag: connection.refresh_token_tag,
    });
    if (migrated) {
      const encrypted = encryptSecret(plaintext);
      getDb()
        .prepare(
          `UPDATE provider_connections
           SET encrypted_refresh_token = ?, refresh_token_iv = ?, refresh_token_tag = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag,
          nowIso(),
          connection.id,
        );
    }
    return plaintext;
  } catch {
    failConnectionDecrypt(connection.id);
  }
}

export function connectionSummaryFromRow(
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

function providerAccountSummaryFromRow(
  row: ProviderAccountRow,
): ProviderAccountSummary {
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

export function getProviderAccounts(
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

export function getConnectionById(
  connectionId: string,
): ProviderConnectionRow | undefined {
  const row = getDb()
    .prepare(
      `SELECT * FROM provider_connections
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(connectionId) as ProviderConnectionRow | undefined;
  return row;
}

export function markConnectionError(
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
    // Provider error bodies can echo credentials in unexpected fields;
    // redact before persisting so /connections never discloses them.
    .run(status, redactSecrets(message), nowIso(), connectionId);
}

function resolveUniqueAccountName(
  db: Database.Database,
  baseName: string,
  provider: AccountLinkProvider,
  providerAccountId: string,
) {
  const providerLabel = provider === "plaid" ? "Plaid" : "Akoya";
  const suffix = providerAccountId.slice(-4) || crypto.randomUUID().slice(0, 4);
  const candidates = [
    baseName,
    `${baseName} (${providerLabel})`,
    `${baseName} ${suffix}`,
  ];

  for (const candidate of candidates) {
    const accountExists = db
      .prepare("SELECT 1 FROM accounts WHERE name = ? AND deleted_at IS NULL")
      .get(candidate);
    const categoryExists = db
      .prepare("SELECT 1 FROM categories WHERE name = ? AND deleted_at IS NULL")
      .get(candidate);
    const subcategoryExists = db
      .prepare(
        "SELECT 1 FROM subcategories WHERE name = ? AND deleted_at IS NULL",
      )
      .get(candidate);
    if (!accountExists && !categoryExists && !subcategoryExists)
      return candidate;
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
    resolveUniqueAccountName(
      db,
      name,
      connection.provider,
      account.providerAccountId,
    ),
    account.type,
    timestamp,
    timestamp,
  );
  return accountId;
}

export function upsertProviderAccount(
  db: Database.Database,
  connection: ProviderConnectionRow,
  account: ProviderAccountDraft,
) {
  const existing = db
    .prepare(
      `SELECT * FROM provider_accounts
       WHERE connection_id = ? AND provider_account_id = ? AND deleted_at IS NULL`,
    )
    .get(connection.id, account.providerAccountId) as
    | ProviderAccountRow
    | undefined;
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

export function listProviderConnections(): ProviderConnectionSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM provider_connections
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all() as ProviderConnectionRow[];
  return rows.map((row) =>
    connectionSummaryFromRow(row, getProviderAccounts(db, row.id)),
  );
}
