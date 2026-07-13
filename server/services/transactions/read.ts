import type { Transaction, TransactionFilters, TransactionWithDetails } from "../../../shared/contracts/index.js";
import { getDb } from "../../db/index.js";
import { getTagsForTransactions } from "../tags.js";
import { buildWhereClause, type RecentActivityRow, type TransactionRow, type TransactionWithDetailsRow, rowToTransaction, rowToTransactionWithDetails } from "./internal.js";

export function getTransactions(
  filters: TransactionFilters = {},
): Transaction[] {
  const db = getDb();
  const { clauses, params } = buildWhereClause(filters);

  let sql = `
    SELECT *
    FROM transactions
    WHERE ${clauses.join(" AND ")}
      AND EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.id = transactions.account_id AND a.deleted_at IS NULL
      )
    ORDER BY date DESC, created_at DESC
  `;

  if (filters.limit != null) {
    sql += " LIMIT ?";
    params.push(filters.limit);
    if (filters.offset != null) {
      sql += " OFFSET ?";
      params.push(filters.offset);
    }
  }

  const rows = db.prepare(sql).all(...params) as TransactionRow[];
  return rows.map(rowToTransaction);
}

export function getTransactionsWithDetails(
  filters: TransactionFilters = {},
): TransactionWithDetails[] {
  const db = getDb();
  const { clauses, params } = buildWhereClause(filters, "t", {
    transaction: "t",
    account: "a",
    subcategory: "s",
    category: "c",
  });

  let sql = `
    SELECT t.*, a.name AS account_name, a.type AS account_type, a.initial_balance AS account_initial_balance, a.color AS account_color,
           s.name AS subcategory_name, s.color AS subcategory_color, s.category_id,
           c.name AS category_name, c.type AS category_type, c.color AS category_color,
           a.initial_balance + (
             SELECT COALESCE(SUM(prior.amount), 0)
             FROM transactions prior
             WHERE prior.account_id = t.account_id
               AND prior.deleted_at IS NULL
               AND (
                 prior.date < t.date
                 OR (
                   prior.date = t.date
                   AND (
                     prior.created_at < t.created_at
                     OR (prior.created_at = t.created_at AND prior.rowid <= t.rowid)
                   )
                 )
               )
           ) AS running_balance
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
    LEFT JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
    LEFT JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
    WHERE ${clauses.join(" AND ")}
    ORDER BY t.date DESC, t.created_at DESC
  `;

  if (filters.limit != null) {
    sql += " LIMIT ?";
    params.push(filters.limit);
    if (filters.offset != null) {
      sql += " OFFSET ?";
      params.push(filters.offset);
    }
  }

  const rows = db.prepare(sql).all(...params) as TransactionWithDetailsRow[];
  const tagMap = getTagsForTransactions(rows.map((row) => row.id));
  return rows.map((row) =>
    rowToTransactionWithDetails(row, tagMap.get(row.id) ?? []),
  );
}

export function getTransactionById(id: string): TransactionWithDetails | null {
  const db = getDb();

  const row = db
    .prepare(
      `
    SELECT t.*, a.name AS account_name, a.type AS account_type, a.initial_balance AS account_initial_balance, a.color AS account_color,
           s.name AS subcategory_name, s.color AS subcategory_color, s.category_id,
           c.name AS category_name, c.type AS category_type, c.color AS category_color
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
    LEFT JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
    LEFT JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
    WHERE t.id = ? AND t.deleted_at IS NULL
  `,
    )
    .get(id) as TransactionWithDetailsRow | undefined;

  if (!row) return null;
  const tagMap = getTagsForTransactions([id]);
  return rowToTransactionWithDetails(row, tagMap.get(id) ?? []);
}

export function getRecentTransactionByNameAndAccount(
  name: string,
  accountId: string,
): Transaction | null {
  const db = getDb();

  const row = db
    .prepare(
      `
    SELECT * FROM transactions
    WHERE name = ? AND account_id = ? AND deleted_at IS NULL
      AND (kind = 'transfer' OR subcategory_id IS NOT NULL)
    ORDER BY date DESC, created_at DESC
    LIMIT 1
  `,
    )
    .get(name, accountId) as TransactionRow | undefined;

  return row ? rowToTransaction(row) : null;
}

export const recentActivityByAccountSql = `
    WITH ranked_transactions AS (
      SELECT
        t.id,
        t.account_id,
        t.date,
        t.name,
        t.amount,
        t.created_at,
        t.rowid,
        a.initial_balance + (
          SELECT COALESCE(SUM(prior.amount), 0)
          FROM transactions prior
          WHERE prior.account_id = t.account_id
            AND prior.deleted_at IS NULL
            AND (
              prior.date < t.date
              OR (
                prior.date = t.date
                AND (
                  prior.created_at < t.created_at
                  OR (prior.created_at = t.created_at AND prior.rowid <= t.rowid)
                )
              )
            )
        ) AS running_balance,
        ROW_NUMBER() OVER (
          PARTITION BY t.account_id
          ORDER BY t.date DESC, t.created_at DESC, t.rowid DESC
        ) AS rn
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
    )
    SELECT
      a.id AS account_id,
      a.name AS account_name,
      a.type AS account_type,
      a.color AS account_color,
      COALESCE(latest.running_balance, a.initial_balance) AS current_balance,
      latest.id AS last_transaction_id,
      latest.date AS last_transaction_date,
      latest.name AS last_transaction_name,
      latest.amount AS last_transaction_amount
    FROM accounts a
    LEFT JOIN ranked_transactions latest ON a.id = latest.account_id AND latest.rn = 1
    WHERE a.deleted_at IS NULL
    ORDER BY a.name ASC
  `;

export function getRecentActivityByAccount(): RecentActivityRow[] {
  const db = getDb();

  const rows = db
    .prepare(recentActivityByAccountSql)
    .all() as RecentActivityRow[];

  return rows;
}
