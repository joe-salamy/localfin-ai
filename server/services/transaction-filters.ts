export function placeholders(list: readonly unknown[]): string {
  return list.map(() => "?").join(", ");
}

export function buildTagExistsClause(
  tagIds: string[] | undefined,
  transactionIdColumn = "t.id",
): { clause: string; params: unknown[] } {
  if (!tagIds || tagIds.length === 0) return { clause: "", params: [] };
  return {
    clause: `EXISTS (SELECT 1 FROM transaction_tags WHERE transaction_id = ${transactionIdColumn} AND tag_id IN (${placeholders(tagIds)}))`,
    params: [...tagIds],
  };
}

/** SQL form of `netWorthEffect`: income is positive, expenses negative, on any account type. */
export function netWorthEffectSql(amountColumn: string, accountTypeColumn: string): string {
  return `(CASE WHEN ${accountTypeColumn} = 'liability' THEN -(${amountColumn}) ELSE ${amountColumn} END)`;
}
