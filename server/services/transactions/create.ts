import type { CreateTransactionData, TransactionWithDetails } from "../../../shared/contracts/index.js";
import { fromBool, getDb } from "../../db/index.js";
import { NotFoundError } from "../../errors.js";
import { replaceTransactionTags } from "../tags.js";
import { getTransactionById } from "./read.js";
import { prepareTransactionInsert } from "./validation.js";

const TRANSACTION_INSERT_SQL =
  "INSERT INTO transactions (id, account_id, date, name, amount, kind, subcategory_id, comment, is_initial_balance, ai_suggested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)";

// Validates and inserts one transaction with its tags. Callers wrap it in a
// DB transaction so a failure rolls back every row of the batch.
function insertTransaction(data: CreateTransactionData, now: string): string {
  const { id, normalized, tagIds } = prepareTransactionInsert(data);
  getDb()
    .prepare(TRANSACTION_INSERT_SQL)
    .run(
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
  return id;
}

export function createTransaction(
  data: CreateTransactionData,
): TransactionWithDetails {
  const now = new Date().toISOString();
  const id = getDb().transaction(() => insertTransaction(data, now))();
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
  const now = new Date().toISOString();
  const ids = getDb().transaction(() =>
    transactions.map((data) => insertTransaction(data, now)),
  )();
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
