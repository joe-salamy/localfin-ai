import type { AccountType, BulkTransactionUpdateData, TransactionKind } from "../../../shared/contracts/index.js";
import { normalizeTransactionAmount } from "../../../shared/finance/transactionAmounts.js";
import { getDb } from "../../db/index.js";
import { BadRequestError } from "../../errors.js";
import { addTransactionTags, assertActiveTags, removeTransactionTags } from "../tags.js";
import { assertActiveSubcategory } from "./validation.js";

export function bulkUpdateTransactions(
  ids: string[],
  updates: BulkTransactionUpdateData,
): void {
  if (ids.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();
  const addTagIds = assertActiveTags(updates.add_tag_ids ?? []);
  const removeTagIds = assertActiveTags(updates.remove_tag_ids ?? []);
  const addTagSet = new Set(addTagIds);

  for (const tagId of removeTagIds) {
    if (addTagSet.has(tagId)) {
      throw new BadRequestError("Cannot add and remove the same tag in one bulk update")
    }
  }

  const hasTagUpdates = addTagIds.length > 0 || removeTagIds.length > 0;
  if (
    updates.kind === undefined &&
    updates.subcategory_id === undefined &&
    !hasTagUpdates
  ) {
    throw new BadRequestError("At least one update field is required")
  }

  const placeholders = ids.map(() => "?").join(", ");
  const params: unknown[] = [];
  const setClauses: string[] = [];
  const updateRows = db
    .prepare(
      `
      SELECT t.id, t.amount, t.kind, a.type AS account_type
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND t.id IN (${placeholders})
    `,
    )
    .all(...ids) as {
    id: string;
    amount: number;
    kind: TransactionKind;
    account_type: AccountType;
  }[];

  if (updates.kind !== undefined) {
    const nextKind = updates.kind;
    const nextSubcategoryId =
      updates.subcategory_id !== undefined
        ? nextKind === "transfer" || nextKind === "adjustment"
          ? null
          : updates.subcategory_id
        : undefined;
    if (nextSubcategoryId) {
      assertActiveSubcategory(nextSubcategoryId);
    }

    const clauses = ["kind = ?", "amount = ?"];
    if (
      nextSubcategoryId !== undefined ||
      nextKind === "transfer" ||
      nextKind === "adjustment"
    ) {
      clauses.push("subcategory_id = ?");
    }
    clauses.push("updated_at = ?");

    const stmt = db.prepare(
      `UPDATE transactions SET ${clauses.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
    );
    const updateAll = db.transaction(() => {
      for (const row of updateRows) {
        const amount = normalizeTransactionAmount(
          row.amount,
          row.account_type,
          nextKind,
        );
        const rowParams: unknown[] = [nextKind, amount];
        if (
          nextSubcategoryId !== undefined ||
          nextKind === "transfer" ||
          nextKind === "adjustment"
        ) {
          rowParams.push(nextSubcategoryId ?? null);
        }
        rowParams.push(now, row.id);
        stmt.run(...rowParams);
        if (addTagIds.length > 0) addTransactionTags(row.id, addTagIds);
        if (removeTagIds.length > 0)
          removeTransactionTags(row.id, removeTagIds);
      }
    });
    updateAll();
    return;
  }

  if (updates.subcategory_id !== undefined) {
    const nextSubcategoryId = updates.subcategory_id;
    if (nextSubcategoryId) {
      assertActiveSubcategory(nextSubcategoryId);
    }
    if (nextSubcategoryId !== null) {
      setClauses.push(
        "subcategory_id = CASE WHEN kind IN ('transfer', 'adjustment') THEN NULL ELSE ? END",
      );
    } else {
      setClauses.push("subcategory_id = ?");
    }
    params.push(nextSubcategoryId);
  }

  const updateAll = db.transaction(() => {
    if (setClauses.length > 0) {
      setClauses.push("updated_at = ?");
      params.push(now);
      params.push(...ids);

      db.prepare(
        `UPDATE transactions SET ${setClauses.join(", ")}
         WHERE deleted_at IS NULL
           AND id IN (${placeholders})
           AND EXISTS (
             SELECT 1 FROM accounts a
             WHERE a.id = transactions.account_id AND a.deleted_at IS NULL
           )`,
      ).run(...params);
    }
    if (hasTagUpdates) {
      for (const row of updateRows) {
        if (addTagIds.length > 0) addTransactionTags(row.id, addTagIds);
        if (removeTagIds.length > 0)
          removeTransactionTags(row.id, removeTagIds);
      }
    }
  });

  updateAll();
}
