import type { Transaction } from "../../../shared/contracts/index.js";
import { normalizeTransactionAmount } from "../../../shared/finance/transactionAmounts.js";
import { getActiveAccountType } from "./validation.js";
import { getDb } from "../../db/index.js";
import {
  type DuplicateCheckItem,
  type TransactionRow,
  rowToTransaction,
} from "./internal.js";

export function checkDuplicates(transactions: DuplicateCheckItem[]): boolean[] {
  if (transactions.length === 0) return [];

  const db = getDb();

  const stmt = db.prepare(`
    SELECT COUNT(*) AS cnt FROM transactions
    WHERE date = ? AND name = ? AND amount = ? AND account_id = ? AND deleted_at IS NULL
  `);

  return transactions.map((t) => {
    const accountType = getActiveAccountType(t.account_id);
    const amount = normalizeTransactionAmount(t.amount, accountType, "expense");
    const row = stmt.get(t.date, t.name, amount, t.account_id) as {
      cnt: number;
    };
    return row.cnt > 0;
  });
}

export function checkTransferMatch(
  amount: number,
  accountId: string,
  date: string,
): Transaction | null {
  const db = getDb();

  const row = db
    .prepare(
      `
    SELECT * FROM transactions
    WHERE account_id != ?
      AND amount = ?
      AND deleted_at IS NULL
      AND date BETWEEN date(?, '-3 days') AND date(?, '+3 days')
    ORDER BY ABS(julianday(date) - julianday(?)) ASC
    LIMIT 1
  `,
    )
    .get(accountId, -amount, date, date, date) as TransactionRow | undefined;

  return row ? rowToTransaction(row) : null;
}
