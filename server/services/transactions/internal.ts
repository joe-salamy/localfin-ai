import type { Tag, Transaction, TransactionFilters, TransactionKind, TransactionWithDetails } from "../../../shared/contracts/index.js";
import { toBool } from "../../db/index.js";
import { compileTransactionSearch } from "../transaction-search.js";

// ---------- Raw DB row types ----------

export interface TransactionRow {
  id: string;
  account_id: string;
  date: string;
  name: string;
  amount: number;
  kind: TransactionKind;
  subcategory_id: string | null;
  comment: string | null;
  is_initial_balance: number;
  ai_suggested: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TransactionWithDetailsRow extends TransactionRow {
  account_name: string | null;
  account_type: string | null;
  account_initial_balance: number | null;
  account_color: string | null;
  subcategory_name: string | null;
  subcategory_color: string | null;
  category_id: string | null;
  category_name: string | null;
  category_type: string | null;
  category_color: string | null;
  running_balance?: number | null;
}

export interface RecentActivityRow {
  account_id: string;
  account_name: string;
  account_type: string;
  account_color: string | null;
  current_balance: number;
  last_transaction_id: string | null;
  last_transaction_date: string | null;
  last_transaction_name: string | null;
  last_transaction_amount: number | null;
}

export interface DuplicateCheckItem {
  date: string;
  name: string;
  amount: number;
  account_id: string;
}

// ---------- Helpers ----------

export function rowToTransaction(row: TransactionRow): Transaction {
  return {
    ...row,
    is_initial_balance: toBool(row.is_initial_balance),
    ai_suggested: toBool(row.ai_suggested),
  };
}

export function rowToTransactionWithDetails(
  row: TransactionWithDetailsRow,
  tags: Tag[] = [],
): TransactionWithDetails {
  return {
    ...rowToTransaction(row),
    account_name: row.account_name ?? undefined,
    account_type: row.account_type ?? undefined,
    account_color: row.account_color,
    subcategory_name: row.subcategory_name ?? undefined,
    subcategory_color: row.subcategory_color,
    category_id: row.category_id ?? undefined,
    category_name: row.category_name ?? undefined,
    category_type: row.category_type ?? undefined,
    category_color: row.category_color,
    running_balance: row.running_balance ?? undefined,
    tags,
  };
}

export function buildWhereClause(
  filters: TransactionFilters,
  prefix = "",
  searchAliases?: Parameters<typeof compileTransactionSearch>[1],
): {
  clauses: string[];
  params: unknown[];
} {
  const p = prefix ? `${prefix}.` : "";
  const transactionIdColumn = prefix ? `${prefix}.id` : "transactions.id";
  const clauses: string[] = [`${p}deleted_at IS NULL`];
  const params: unknown[] = [];
  const addInClause = (column: string, values?: string[]) => {
    if (!values || values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
    params.push(...values);
  };

  if (filters.accountId) {
    clauses.push(`${p}account_id = ?`);
    params.push(filters.accountId);
  }
  addInClause(`${p}account_id`, filters.accountIds);
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM subcategories filter_s
        JOIN categories filter_c
          ON filter_s.category_id = filter_c.id
          AND filter_c.deleted_at IS NULL
        WHERE filter_s.id = ${p}subcategory_id
          AND filter_s.deleted_at IS NULL
          AND filter_c.id IN (${filters.categoryIds.map(() => "?").join(", ")})
      )
    `);
    params.push(...filters.categoryIds);
  }
  if (filters.subcategoryId) {
    clauses.push(`${p}subcategory_id = ?`);
    params.push(filters.subcategoryId);
  }
  addInClause(`${p}subcategory_id`, filters.subcategoryIds);
  if (filters.tagIds && filters.tagIds.length > 0) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM transaction_tags filter_tt
        JOIN tags filter_tag
          ON filter_tag.id = filter_tt.tag_id
          AND filter_tag.deleted_at IS NULL
        WHERE filter_tt.transaction_id = ${transactionIdColumn}
          AND filter_tt.tag_id IN (${filters.tagIds.map(() => "?").join(", ")})
      )
    `);
    params.push(...filters.tagIds);
  }
  if (filters.kind) {
    clauses.push(`${p}kind = ?`);
    params.push(filters.kind);
  }
  if (filters.needsCategory) {
    clauses.push(`${p}kind IN ('income', 'expense')`);
    clauses.push(`${p}subcategory_id IS NULL`);
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
