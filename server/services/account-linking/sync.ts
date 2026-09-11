import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "../../db/index.js";
import { ConflictError, NotFoundError } from "../../errors.js";
import {
  mapAkoyaTransactionToLocal,
  mapPlaidTransactionToLocal,
  type AkoyaTransaction,
  type PlaidTransaction,
  type ProviderTransactionDraft,
} from "../provider-mappers.js";
import type {
  AccountType,
  ProviderSyncResult,
} from "../../../shared/contracts/index.js";
import type { AccountLinkingDependencies } from "./service.js";
import { fetchPlaidPayload } from "./plaid.js";
import { fetchAkoyaPayload } from "./akoya.js";
import {
  decryptAccessToken,
  decryptRefreshToken,
  encryptedColumns,
  getConnectionById,
  nowIso,
  readNumber,
  readString,
  roundCurrency,
  todayIsoDate,
  upsertProviderAccount,
  type AccountRow,
  type ApplyCounts,
  type BalanceRow,
  type NetworkPayload,
  type ProviderAccountDraft,
  type ProviderConnectionRow,
  type TransactionIdRow,
} from "./connections.js";

/** Connections with a sync currently in flight (per-process guard). */
const activeSyncs = new Set<string>();

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
    .get(draft.provider, draft.provider_transaction_id) as
    | TransactionIdRow
    | undefined;
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
    warnings.push(
      `Missing provider balance for ${account.name}; skipped balance adjustment.`,
    );
    return 0;
  }

  const localAccount = db
    .prepare(
      "SELECT id, name, type, initial_balance FROM accounts WHERE id = ?",
    )
    .get(localAccountId) as AccountRow | undefined;
  if (!localAccount)
    throw new NotFoundError(`Local account ${localAccountId} not found`)

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
    const accountMap = new Map<
      string,
      { localAccountId: string; type: AccountType }
    >();
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
          : (readString(transaction, "accountId") ??
            readString(transaction, "account_id"));
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
      const [ciphertext, iv, tag] = encryptedColumns(
        payload.refreshedAccessToken,
      );
      db.prepare(
        `UPDATE provider_connections
         SET encrypted_access_token = ?, access_token_iv = ?, access_token_tag = ?
         WHERE id = ?`,
      ).run(ciphertext, iv, tag, connection.id);
    }
    if (payload.refreshedRefreshToken) {
      const [ciphertext, iv, tag] = encryptedColumns(
        payload.refreshedRefreshToken,
      );
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

export async function syncProviderConnections(
  input: { connectionId?: string } = {},
  dependencies: AccountLinkingDependencies,
): Promise<ProviderSyncResult[]> {
  const db = getDb();
  const connections = input.connectionId
    ? [getConnectionById(input.connectionId)].filter(
        (connection): connection is ProviderConnectionRow =>
          connection !== undefined,
      )
    : (db
        .prepare(
          `SELECT * FROM provider_connections
           WHERE status = 'active' AND deleted_at IS NULL
           ORDER BY created_at`,
        )
        .all() as ProviderConnectionRow[]);

  if (input.connectionId && connections.length === 0) {
    throw new NotFoundError(`Provider connection with id "${input.connectionId}" not found`)
  }
  if (input.connectionId && connections[0]?.status !== "active") {
    throw new ConflictError(`Provider connection with id "${input.connectionId}" is not active; reconnect the account before syncing`)
  }

  const results: ProviderSyncResult[] = [];
  for (const connection of connections) {
    if (activeSyncs.has(connection.id)) {
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        accountsUpserted: 0,
        transactionsAdded: 0,
        transactionsUpdated: 0,
        transactionsRemoved: 0,
        balanceAdjustmentsCreated: 0,
        warnings: ["Sync already in progress for this connection; skipped."],
        syncedAt: nowIso(),
      });
      continue;
    }

    const warnings: string[] = [];
    const syncedAt = nowIso();
    activeSyncs.add(connection.id);
    try {
      const payload =
        connection.provider === "plaid"
          ? await fetchPlaidPayload(connection, dependencies.plaid)
          : await fetchAkoyaPayload(connection, dependencies.akoya);
      const counts = applyNetworkPayload(connection, payload, syncedAt, warnings);
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        ...counts,
        warnings,
        syncedAt,
      });
    } finally {
      activeSyncs.delete(connection.id);
    }
  }
  return results;
}

export async function disconnectProviderConnection(
  connectionId: string,
  dependencies: AccountLinkingDependencies,
): Promise<void> {
  const connection = getConnectionById(connectionId);
  if (!connection) {
    throw new NotFoundError(`Provider connection with id "${connectionId}" not found`)
  }

  if (connection.provider === "plaid") {
    await dependencies.plaid.removeItem(decryptAccessToken(connection));
  } else {
    try {
      await dependencies.akoya.revokeToken({
        refreshToken: decryptRefreshToken(connection),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Akoya revoke error";
      const status = readNumber(error, "status");
      if (
        status !== 404 &&
        status !== 501 &&
        !message.includes("404") &&
        !message.includes("501")
      ) {
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
