import type { AccountType } from "@shared/contracts";
import type { TransactionRow } from "./draft";
import {
  displayAmountToNumber,
  normalizeRowAmountDisplay,
  toApiDate,
} from "./draft";
export interface DuplicateCheckCandidate {
  date: string;
  name: string;
  amount: number;
  account_id: string;
}

export function buildDuplicateCheckPayload(
  rows: readonly TransactionRow[],
  accounts: { id: string; type: AccountType }[],
): DuplicateCheckCandidate[] {
  return rows.map((row) => ({
    date: toApiDate(row.date),
    name: row.name,
    amount: displayAmountToNumber(normalizeRowAmountDisplay(row, accounts)),
    account_id: row.account_id,
  }));
}

export function applyDuplicateCheckResults(
  rows: readonly TransactionRow[],
  filledRows: readonly TransactionRow[],
  results: readonly boolean[],
): TransactionRow[] {
  const filledIds = new Set(filledRows.map((row) => row.id));
  let filledIndex = 0;
  return rows.map((row) => {
    if (!filledIds.has(row.id)) return row;
    const isDuplicate = results[filledIndex] ?? false;
    filledIndex += 1;
    return { ...row, isDuplicate };
  });
}
export async function transactionVersionsMatch(
  snapshots: readonly { id: string }[],
  expectedUpdatedAt: ReadonlyMap<string, string>,
  getCurrent: (id: string) => Promise<{ updated_at: string } | null>,
): Promise<boolean> {
  const current = await Promise.all(
    snapshots.map((snapshot) => getCurrent(snapshot.id)),
  );
  return current.every(
    (transaction, index) =>
      transaction?.updated_at ===
      expectedUpdatedAt.get(snapshots[index]?.id ?? ""),
  );
}
