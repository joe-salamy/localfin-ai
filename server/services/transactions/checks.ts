import type { Transaction } from "../../../shared/contracts/index.js";
import { netWorthEffect } from "../../../shared/finance/transactionAmounts.js";
import { getDb } from "../../db/index.js";
import { netWorthEffectSql } from "../transaction-filters.js";
import {
  type DuplicateCheckItem,
  type TransactionRow,
  rowToTransaction,
} from "./internal.js";
import { getActiveAccountType } from "./validation.js";

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

/**
 * Finds the other side of a transfer: a transaction on another account within
 * three days whose net-worth effect cancels this one. Between two assets the
 * stored signs are opposite; between an asset and a liability (a card payment)
 * both sides are stored negative.
 */
export function checkTransferMatch(
  amount: number,
  accountId: string,
  date: string,
): Transaction | null {
  const db = getDb();
  const effect = netWorthEffect(amount, getActiveAccountType(accountId));
  const row = db
    .prepare(
      `
    SELECT t.* FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    WHERE t.account_id != ?
      AND ABS(${netWorthEffectSql("t.amount", "a.type")} + ?) < 0.005
      AND t.deleted_at IS NULL
      AND t.date BETWEEN date(?, '-3 days') AND date(?, '+3 days')
    ORDER BY ABS(julianday(t.date) - julianday(?)) ASC
    LIMIT 1
  `,
    )
    .get(accountId, effect, date, date, date) as TransactionRow | undefined;
  return row ? rowToTransaction(row) : null;
}
