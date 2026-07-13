import type { TransactionWithDetails } from "../../../shared/contracts/index.js";
import { getDb } from "../../db/index.js";
import { ConflictError, NotFoundError } from "../../errors.js";
import { getTransactionById } from "./read.js";
import type { TransactionRow } from "./internal.js";
import { assertActiveSubcategory, getActiveAccountType } from "./validation.js";

interface RestoreTransactionRow extends TransactionRow {
  provider: string | null;
  provider_transaction_id: string | null;
}

function restoreTransactionRecord(id: string): TransactionWithDetails {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM transactions WHERE id = ?")
    .get(id) as RestoreTransactionRow | undefined;

  if (!existing || existing.deleted_at === null) {
    throw new NotFoundError(`Transaction with id "${id}" not found`)
  }

  getActiveAccountType(existing.account_id);

  if (existing.subcategory_id) {
    assertActiveSubcategory(existing.subcategory_id);
  }

  if (existing.provider && existing.provider_transaction_id) {
    const conflict = db
      .prepare(
        `SELECT 1
         FROM transactions
         WHERE provider = ?
           AND provider_transaction_id = ?
           AND deleted_at IS NULL
           AND id != ?`,
      )
      .get(existing.provider, existing.provider_transaction_id, id);

    if (conflict) {
      throw new ConflictError("An active transaction already exists for this provider transaction")
    }
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?",
  ).run(now, id);

  const transaction = getTransactionById(id);
  if (!transaction) {
    throw new NotFoundError(`Transaction with id "${id}" not found`)
  }
  return transaction;
}

export function deleteTransaction(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .prepare(
      "UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .run(now, now, id);

  if (result.changes === 0) {
    throw new NotFoundError(`Transaction with id "${id}" not found`)
  }
}

export function bulkDeleteTransactions(ids: string[]): void {
  if (ids.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(", ");

  db.prepare(
    `UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND id IN (${placeholders})`,
  ).run(now, now, ...ids);
}

export function restoreTransaction(id: string): TransactionWithDetails {
  const db = getDb();
  const restore = db.transaction(() => restoreTransactionRecord(id));
  return restore();
}

export function bulkRestoreTransactions(
  ids: string[],
): TransactionWithDetails[] {
  if (ids.length === 0) return [];

  const db = getDb();
  const restoreAll = db.transaction(() => ids.map(restoreTransactionRecord));
  return restoreAll();
}
