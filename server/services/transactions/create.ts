import type { CreateTransactionData, TransactionWithDetails } from "../../../shared/contracts/index.js";
import { fromBool, getDb } from "../../db/index.js";
import { NotFoundError } from "../../errors.js";
import { replaceTransactionTags } from "../tags.js";
import { getTransactionById } from "./read.js";
import { TRANSACTION_INSERT_SQL, prepareTransactionInsert } from "./validation.js";

export function createTransaction(
  data: CreateTransactionData,
): TransactionWithDetails {
  const db = getDb();
  const now = new Date().toISOString();
  const { id, normalized, tagIds } = prepareTransactionInsert(data);

  const stmt = db.prepare(TRANSACTION_INSERT_SQL);

  const createTransactionWithTags = db.transaction(() => {
    stmt.run(
      id,
      normalized.account_id,
      normalized.date,
      normalized.name,
      normalized.amount,
      normalized.kind,
      normalized.subcategory_id,
      normalized.comment ?? null,
      fromBool(normalized.ai_suggested ?? false),
      now,
      now,
    );
    replaceTransactionTags(id, tagIds);
  });

  createTransactionWithTags();

  const transaction = getTransactionById(id);
  if (!transaction) {
    throw new NotFoundError(`Transaction with id "${id}" not found`)
  }
  return transaction;
}

export function bulkCreateTransactions(
  transactions: CreateTransactionData[],
): TransactionWithDetails[] {
  if (transactions.length === 0) return [];

  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(TRANSACTION_INSERT_SQL);

  const ids: string[] = [];

  const insertAll = db.transaction(() => {
    for (const data of transactions) {
      const { id, normalized, tagIds } = prepareTransactionInsert(data);
      ids.push(id);
      stmt.run(
        id,
        normalized.account_id,
        normalized.date,
        normalized.name,
        normalized.amount,
        normalized.kind,
        normalized.subcategory_id,
        normalized.comment ?? null,
        fromBool(normalized.ai_suggested ?? false),
        now,
        now,
      );
      replaceTransactionTags(id, tagIds);
    }
  });

  insertAll();

  return ids
    .map((id) => getTransactionById(id))
    .filter(
      (transaction): transaction is TransactionWithDetails =>
        transaction !== null,
    )
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.created_at.localeCompare(a.created_at);
    });
}
