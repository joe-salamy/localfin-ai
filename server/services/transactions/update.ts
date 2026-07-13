import type { AccountType, TransactionKind, TransactionWithDetails, UpdateTransactionData } from "../../../shared/contracts/index.js";
import { normalizeTransactionAmount } from "../../../shared/finance/transactionAmounts.js";
import { fromBool, getDb } from "../../db/index.js";
import { NotFoundError } from "../../errors.js";
import { assertActiveTags, replaceTransactionTags } from "../tags.js";
import { getTransactionById } from "./read.js";
import { assertActiveSubcategory } from "./validation.js";

export function updateTransaction(
  id: string,
  updates: UpdateTransactionData,
): TransactionWithDetails | null {
  const db = getDb();

  const existing = db
    .prepare(
      `
    SELECT t.id, t.kind, t.amount, a.type AS account_type
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
    WHERE t.id = ? AND t.deleted_at IS NULL
  `,
    )
    .get(id) as
    | {
        id: string;
        kind: TransactionKind;
        amount: number;
        account_type: AccountType;
      }
    | undefined;

  if (!existing) {
    throw new NotFoundError(`Transaction with id "${id}" not found`)
  }

  const nextKind = updates.kind ?? existing.kind;
  const nextAmount =
    updates.amount !== undefined || updates.kind !== undefined
      ? normalizeTransactionAmount(
          updates.amount ?? existing.amount,
          existing.account_type,
          nextKind,
        )
      : undefined;
  const nextTagIds =
    updates.tag_ids !== undefined
      ? assertActiveTags(updates.tag_ids)
      : undefined;
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.date !== undefined) {
    setClauses.push("date = ?");
    params.push(updates.date);
  }
  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    params.push(updates.name);
  }
  if (nextAmount !== undefined) {
    setClauses.push("amount = ?");
    params.push(nextAmount);
  }
  if (updates.kind !== undefined) {
    setClauses.push("kind = ?");
    params.push(updates.kind);
    if (
      (updates.kind === "transfer" || updates.kind === "adjustment") &&
      updates.subcategory_id === undefined
    ) {
      setClauses.push("subcategory_id = ?");
      params.push(null);
    }
  }
  if (updates.subcategory_id !== undefined) {
    const nextSubcategoryId =
      nextKind === "transfer" || nextKind === "adjustment"
        ? null
        : updates.subcategory_id;
    if (nextSubcategoryId) {
      assertActiveSubcategory(nextSubcategoryId);
    }
    setClauses.push("subcategory_id = ?");
    params.push(nextSubcategoryId);
  }
  if (updates.comment !== undefined) {
    setClauses.push("comment = ?");
    params.push(updates.comment);
  }
  if (updates.ai_suggested !== undefined) {
    setClauses.push("ai_suggested = ?");
    params.push(fromBool(updates.ai_suggested));
  }

  const updateTransactionAndTags = db.transaction(() => {
    if (setClauses.length > 0) {
      setClauses.push("updated_at = ?");
      params.push(new Date().toISOString());
      params.push(id);

      db.prepare(
        `UPDATE transactions SET ${setClauses.join(", ")} WHERE id = ?`,
      ).run(...params);
    }
    if (nextTagIds !== undefined) {
      replaceTransactionTags(id, nextTagIds);
    }
  });

  updateTransactionAndTags();
  return getTransactionById(id);
}
