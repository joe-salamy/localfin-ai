import crypto from "node:crypto";
import type {
  Transaction,
  TransactionWithDetails,
  TransactionFilters,
  CreateTransactionData,
} from "../../src/types/index.js";
import { getDb, toBool, fromBool } from "../db/index.js";
import { compileTransactionSearch } from "./transaction-search.js";

// ---------- Raw DB row types ----------

interface TransactionRow {
  id: string;
  account_id: string;
  date: string;
  name: string;
  amount: number;
  subcategory_id: string | null;
  comment: string | null;
  is_initial_balance: number;
  ai_suggested: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface TransactionWithDetailsRow extends TransactionRow {
  account_name: string | null;
  account_type: string | null;
  subcategory_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_type: string | null;
  running_balance?: number | null;
}

interface RecentActivityRow {
  account_id: string;
  account_name: string;
  account_type: string;
  current_balance: number;
  last_transaction_id: string | null;
  last_transaction_date: string | null;
  last_transaction_name: string | null;
  last_transaction_amount: number | null;
}

interface UpdateTransactionData {
  date?: string;
  name?: string;
  amount?: number;
  subcategory_id?: string | null;
  comment?: string | null;
  ai_suggested?: boolean;
}

interface DuplicateCheckItem {
  date: string;
  name: string;
  amount: number;
  account_id: string;
}

// ---------- Helpers ----------

function rowToTransaction(row: TransactionRow): Transaction {
  return {
    ...row,
    is_initial_balance: toBool(row.is_initial_balance),
    ai_suggested: toBool(row.ai_suggested),
  };
}

function rowToTransactionWithDetails(
  row: TransactionWithDetailsRow,
): TransactionWithDetails {
  return {
    ...rowToTransaction(row),
    account_name: row.account_name ?? undefined,
    account_type: row.account_type ?? undefined,
    subcategory_name: row.subcategory_name ?? undefined,
    category_id: row.category_id ?? undefined,
    category_name: row.category_name ?? undefined,
    category_type: row.category_type ?? undefined,
    running_balance: row.running_balance ?? undefined,
  };
}

function buildWhereClause(
  filters: TransactionFilters,
  prefix = "",
  searchAliases?: Parameters<typeof compileTransactionSearch>[1],
): {
  clauses: string[];
  params: unknown[];
} {
  const p = prefix ? `${prefix}.` : "";
  const clauses: string[] = [`${p}deleted_at IS NULL`];
  const params: unknown[] = [];

  if (filters.accountId) {
    clauses.push(`${p}account_id = ?`);
    params.push(filters.accountId);
  }
  if (filters.subcategoryId) {
    clauses.push(`${p}subcategory_id = ?`);
    params.push(filters.subcategoryId);
  }
  if (filters.startDate) {
    clauses.push(`${p}date >= ?`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    clauses.push(`${p}date <= ?`);
    params.push(filters.endDate);
  }
  if (filters.searchQuery) {
    const compiledSearch = compileTransactionSearch(
      filters.searchQuery,
      searchAliases ?? { transaction: prefix || "transactions" },
    );
    clauses.push(compiledSearch.clause);
    params.push(...compiledSearch.params);
  }

  return { clauses, params };
}

function assertActiveAccount(accountId: string): void {
  const db = getDb();
  const account = db
    .prepare("SELECT 1 FROM accounts WHERE id = ? AND deleted_at IS NULL")
    .get(accountId);
  if (!account) {
    throw new Error(`Account with id "${accountId}" not found`);
  }
}

function assertActiveSubcategory(subcategoryId: string): void {
  const db = getDb();
  const subcategory = db
    .prepare(
      `
    SELECT 1
    FROM subcategories s
    JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
    WHERE s.id = ? AND s.deleted_at IS NULL
  `,
    )
    .get(subcategoryId);

  if (!subcategory) {
    throw new Error(`Subcategory with id "${subcategoryId}" not found`);
  }
}

// ---------- CRUD ----------

export function createTransaction(data: CreateTransactionData): Transaction {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  assertActiveAccount(data.account_id);
  if (data.subcategory_id) {
    assertActiveSubcategory(data.subcategory_id);
  }

  const stmt = db.prepare(`
    INSERT INTO transactions (id, account_id, date, name, amount, subcategory_id, comment, is_initial_balance, ai_suggested, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.account_id,
    data.date,
    data.name,
    data.amount,
    data.subcategory_id ?? null,
    data.comment ?? null,
    fromBool(data.ai_suggested ?? false),
    now,
    now,
  );

  const row = db
    .prepare("SELECT * FROM transactions WHERE id = ?")
    .get(id) as TransactionRow;
  return rowToTransaction(row);
}

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
    SELECT t.*, a.name AS account_name, a.type AS account_type,
           s.name AS subcategory_name, s.category_id,
           c.name AS category_name, c.type AS category_type,
           (
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
  return rows.map(rowToTransactionWithDetails);
}

export function getTransactionById(id: string): TransactionWithDetails | null {
  const db = getDb();

  const row = db
    .prepare(
      `
    SELECT t.*, a.name AS account_name, a.type AS account_type,
           s.name AS subcategory_name, s.category_id,
           c.name AS category_name, c.type AS category_type
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
    LEFT JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
    LEFT JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
    WHERE t.id = ? AND t.deleted_at IS NULL
  `,
    )
    .get(id) as TransactionWithDetailsRow | undefined;

  return row ? rowToTransactionWithDetails(row) : null;
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
    WHERE name = ? AND account_id = ? AND subcategory_id IS NOT NULL AND deleted_at IS NULL
    ORDER BY date DESC, created_at DESC
    LIMIT 1
  `,
    )
    .get(name, accountId) as TransactionRow | undefined;

  return row ? rowToTransaction(row) : null;
}

export function getRecentActivityByAccount(): RecentActivityRow[] {
  const db = getDb();

  const rows = db
    .prepare(
      `
    WITH ranked_transactions AS (
      SELECT
        t.id,
        t.account_id,
        t.date,
        t.name,
        t.amount,
        t.created_at,
        t.rowid,
        (
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
      WHERE t.deleted_at IS NULL
    )
    SELECT
      a.id AS account_id,
      a.name AS account_name,
      a.type AS account_type,
      COALESCE(latest.running_balance, 0) AS current_balance,
      latest.id AS last_transaction_id,
      latest.date AS last_transaction_date,
      latest.name AS last_transaction_name,
      latest.amount AS last_transaction_amount
    FROM accounts a
    LEFT JOIN ranked_transactions latest ON a.id = latest.account_id AND latest.rn = 1
    WHERE a.deleted_at IS NULL
    ORDER BY a.name ASC
  `,
    )
    .all() as RecentActivityRow[];

  return rows;
}

export function updateTransaction(
  id: string,
  updates: UpdateTransactionData,
): Transaction | null {
  const db = getDb();

  const existing = db
    .prepare(
      `
    SELECT t.id
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
    WHERE t.id = ? AND t.deleted_at IS NULL
  `,
    )
    .get(id);

  if (!existing) {
    throw new Error(`Transaction with id "${id}" not found`);
  }

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
  if (updates.amount !== undefined) {
    setClauses.push("amount = ?");
    params.push(updates.amount);
  }
  if (updates.subcategory_id !== undefined) {
    if (updates.subcategory_id) {
      assertActiveSubcategory(updates.subcategory_id);
    }
    setClauses.push("subcategory_id = ?");
    params.push(updates.subcategory_id);
  }
  if (updates.comment !== undefined) {
    setClauses.push("comment = ?");
    params.push(updates.comment);
  }
  if (updates.ai_suggested !== undefined) {
    setClauses.push("ai_suggested = ?");
    params.push(fromBool(updates.ai_suggested));
  }
  if (setClauses.length === 0) return getTransactionById(id);

  setClauses.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(
    `UPDATE transactions SET ${setClauses.join(", ")} WHERE id = ?`,
  ).run(...params);

  return getTransactionById(id);
}

export function bulkUpdateTransactions(
  ids: string[],
  updates: { subcategory_id?: string | null },
): void {
  if (ids.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  const placeholders = ids.map(() => "?").join(", ");
  const params: unknown[] = [];

  const setClauses: string[] = [];

  if (updates.subcategory_id !== undefined) {
    if (updates.subcategory_id) {
      assertActiveSubcategory(updates.subcategory_id);
    }
    setClauses.push("subcategory_id = ?");
    params.push(updates.subcategory_id);
  }

  if (setClauses.length === 0) return;

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

export function deleteTransaction(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .prepare(
      "UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .run(now, now, id);

  if (result.changes === 0) {
    throw new Error(`Transaction with id "${id}" not found`);
  }
}

export function bulkDeleteTransactions(ids: string[]): void {
  if (ids.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(", ");

  db.prepare(
    `UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND id IN (${placeholders})`,
  ).run(now, now, ...ids);
}

export function bulkCreateTransactions(
  transactions: CreateTransactionData[],
): Transaction[] {
  if (transactions.length === 0) return [];

  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO transactions (id, account_id, date, name, amount, subcategory_id, comment, is_initial_balance, ai_suggested, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);

  const ids: string[] = [];

  const insertAll = db.transaction(() => {
    for (const data of transactions) {
      assertActiveAccount(data.account_id);
      if (data.subcategory_id) {
        assertActiveSubcategory(data.subcategory_id);
      }

      const id = crypto.randomUUID();
      ids.push(id);
      stmt.run(
        id,
        data.account_id,
        data.date,
        data.name,
        data.amount,
        data.subcategory_id ?? null,
        data.comment ?? null,
        fromBool(data.ai_suggested ?? false),
        now,
        now,
      );
    }
  });

  insertAll();

  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT * FROM transactions WHERE id IN (${placeholders}) ORDER BY date DESC, created_at DESC`,
    )
    .all(...ids) as TransactionRow[];

  return rows.map(rowToTransaction);
}

export function checkDuplicates(transactions: DuplicateCheckItem[]): boolean[] {
  if (transactions.length === 0) return [];

  const db = getDb();

  const stmt = db.prepare(`
    SELECT COUNT(*) AS cnt FROM transactions
    WHERE date = ? AND name = ? AND amount = ? AND account_id = ? AND deleted_at IS NULL
  `);

  return transactions.map((t) => {
    const row = stmt.get(t.date, t.name, t.amount, t.account_id) as {
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
