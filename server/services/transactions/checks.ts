import type { Transaction } from "../../../shared/contracts/index.js";
import { getDb } from "../../db/index.js";
import {
  type DuplicateCheckItem,
  type TransactionRow,
  rowToTransaction,
} from "./internal.js";

export function checkDuplicates(transactions: DuplicateCheckItem[]): boolean[] {
  if (transactions.length === 0) return [];

  const db = getDb();

  const counts = new Map<string, number>();
  const distinct = new Map<string, DuplicateCheckItem>();
  for (const t of transactions) {
    const key = `${t.date}|${t.name}|${t.amount}|${t.account_id}`;
    if (!distinct.has(key)) distinct.set(key, t);
  }

  const stmt = db.prepare(`
    SELECT COUNT(*) AS cnt FROM transactions
    WHERE date = ? AND name = ? AND amount = ? AND account_id = ? AND deleted_at IS NULL
  `);
  for (const [key, t] of distinct) {
    const row = stmt.get(t.date, t.name, t.amount, t.account_id) as {
      cnt: number;
    };
    counts.set(key, row.cnt);
  }

  const seen = new Map<string, number>();
  return transactions.map((t) => {
    const key = `${t.date}|${t.name}|${t.amount}|${t.account_id}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return occurrence < (counts.get(key) ?? 0);
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
