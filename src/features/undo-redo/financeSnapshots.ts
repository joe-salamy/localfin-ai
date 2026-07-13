import type { TransactionWithDetails, UpdateTransactionData } from "@shared/contracts"

export function transactionSnapshotToUpdate(
  transaction: TransactionWithDetails,
): UpdateTransactionData {
  return {
    date: transaction.date,
    name: transaction.name,
    amount: transaction.amount,
    kind: transaction.kind,
    subcategory_id: transaction.subcategory_id,
    comment: transaction.comment,
    tag_ids: transaction.tags.map((tag) => tag.id),
    ai_suggested: transaction.ai_suggested,
  };
}
