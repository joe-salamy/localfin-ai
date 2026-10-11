import type { AccountType, BulkTransactionUpdateData, TransactionKind } from "../../../shared/contracts/index.js";
import { fromBool, getDb } from "../../db/index.js";
import { BadRequestError } from "../../errors.js";
import { addTransactionTags, assertActiveTags, removeTransactionTags } from "../tags.js";
import { resolveNextState } from "./validation.js";

/** Bulk ops silent-skip unknown ids; single ops throw 404. */
export function bulkUpdateTransactions(
  ids: string[],
  updates: BulkTransactionUpdateData,
): string[] {
  if (ids.length === 0) return [];

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
    updates.ai_suggested === undefined &&
    !hasTagUpdates
  ) {
    throw new BadRequestError("At least one update field is required")
  }

  const placeholders = ids.map(() => "?").join(", ");
  const updateRows = db
    .prepare(
      `
      SELECT t.id, t.amount, t.kind, t.subcategory_id, a.type AS account_type
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND t.id IN (${placeholders})
    `)
    .all(...ids) as {
    id: string;
    amount: number;
    kind: TransactionKind;
    subcategory_id: string | null;
    account_type: AccountType;
  }[];

  const planned = updateRows.map((row) => {
    const { nextKind, nextSubcategoryId, nextAmount } = resolveNextState(row, { kind: updates.kind, subcategory_id: updates.subcategory_id });
    return { row, nextKind, nextSubcategoryId, nextAmount: nextAmount ?? row.amount };
  });
  const stmt = db.prepare(
    `UPDATE transactions SET kind = ?, amount = ?, subcategory_id = ?, ai_suggested = COALESCE(?, ai_suggested), updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
  );
  const aiSuggested = updates.ai_suggested === undefined ? null : fromBool(updates.ai_suggested);
  const updateAll = db.transaction(() => {
    for (const item of planned) {
      stmt.run(item.nextKind, item.nextAmount, item.nextSubcategoryId, aiSuggested, now, item.row.id);
      if (addTagIds.length > 0) addTransactionTags(item.row.id, addTagIds);
      if (removeTagIds.length > 0) removeTransactionTags(item.row.id, removeTagIds);
    }
  });

  updateAll();
  const found = new Set(updateRows.map((row) => row.id));
  return ids.filter((id) => found.has(id));
}
