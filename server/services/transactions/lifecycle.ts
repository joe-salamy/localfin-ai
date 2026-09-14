import type { TransactionWithDetails } from "../../../shared/contracts/index.js";
import { getDb } from "../../db/index.js";
import { NotFoundError } from "../../errors.js";
import { getTransactionById } from "./read.js";
import { assertActiveSubcategory, getActiveAccountType } from "./validation.js";

interface RestoreTransactionRow {
  deleted_at: string | null;
  account_id: string;
  subcategory_id: string | null;
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

/** Bulk ops silent-skip unknown ids; single ops throw 404. */
export function bulkDeleteTransactions(ids: string[]): string[] {
  if (ids.length === 0) return [];

  const db = getDb();
  const now = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(", ");

  const existing = db.prepare(
    `SELECT id FROM transactions WHERE deleted_at IS NULL AND id IN (${placeholders})`,
  ).all(...ids) as { id: string }[];
  const found = new Set(existing.map((row) => row.id));
  const matched = ids.filter((id) => found.has(id));
  if (matched.length === 0) return [];
  const matchedPlaceholders = matched.map(() => "?").join(", ");
  db.prepare(
    `UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND id IN (${matchedPlaceholders})`,
  ).run(now, now, ...matched);
  return matched;
}

export function restoreTransaction(id: string): TransactionWithDetails {
  const db = getDb();
  const restore = db.transaction(() => restoreTransactionRecord(id));
  return restore();
}

/** Bulk ops silent-skip unknown ids; single ops throw 404. */
export function bulkRestoreTransactions(
  ids: string[],
): string[] {
  if (ids.length === 0) return [];

  const updated: string[] = [];
  const db = getDb();
  const restoreAll = db.transaction(() => {
    for (const id of ids) {
      const existing = db.prepare("SELECT id, deleted_at FROM transactions WHERE id = ?").get(id) as { id: string; deleted_at: string | null } | undefined;
      if (!existing || existing.deleted_at === null) continue;
      restoreTransactionRecord(id);
      updated.push(id);
    }
  });
  restoreAll();
  return updated;
}
