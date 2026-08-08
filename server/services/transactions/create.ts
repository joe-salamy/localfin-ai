import crypto from "node:crypto";
import type { CreateTransactionData, TransactionWithDetails } from "../../../shared/contracts/index.js";
import { fromBool, getDb } from "../../db/index.js";
import { NotFoundError } from "../../errors.js";
import { assertActiveTags, replaceTransactionTags } from "../tags.js";
import { getTransactionById } from "./read.js";
import { assertActiveSubcategory, assertKindSubcategoryCompatible, getActiveAccountType, normalizeTransactionFields } from "./validation.js";

export function createTransaction(
  data: CreateTransactionData,
): TransactionWithDetails {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const accountType = getActiveAccountType(data.account_id);
  const normalized = normalizeTransactionFields(data, accountType);
  assertKindSubcategoryCompatible(normalized.kind, data.subcategory_id);
  const tagIds = assertActiveTags(data.tag_ids ?? []);

  if (normalized.subcategory_id) {
    assertActiveSubcategory(normalized.subcategory_id);
  }

  const stmt = db.prepare(`
    INSERT INTO transactions (id, account_id, date, name, amount, kind, subcategory_id, comment, is_initial_balance, ai_suggested, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);

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

  const stmt = db.prepare(`
    INSERT INTO transactions (id, account_id, date, name, amount, kind, subcategory_id, comment, is_initial_balance, ai_suggested, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);

  const ids: string[] = [];

  const insertAll = db.transaction(() => {
    for (const data of transactions) {
      const accountType = getActiveAccountType(data.account_id);
      const normalized = normalizeTransactionFields(data, accountType);
      assertKindSubcategoryCompatible(normalized.kind, data.subcategory_id);
      const tagIds = assertActiveTags(data.tag_ids ?? []);
      if (normalized.subcategory_id) {
        assertActiveSubcategory(normalized.subcategory_id);
      }

      const id = crypto.randomUUID();
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
