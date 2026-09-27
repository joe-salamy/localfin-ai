import {
  addMonthsUtc,
  differenceInCalendarDaysUtc,
  parseIsoDate,
} from "./dates.js";
import { getDb } from "../db/index.js";
import { clampStartDateToFirstTransaction } from "./date-ranges.js";
import { buildTagExistsClause, netWorthEffectSql } from "./transaction-filters.js";
import type { AccountSummary,
AccountTransaction,
AccountType,
CategorySummary,
CategoryType,
DashboardMetrics,
NetWorthSummary,
SubcategorySummary,
TagSummary, } from "../../shared/contracts/index.js"

// === Row types for query results ===

interface AccountRow {
  id: string;
  name: string;
  type: string;
  initial_balance: number;
  color: string | null;
}

interface BalanceRow {
  starting_balance: number;
}

interface TransactionRow {
  id: string;
  date: string;
  name: string;
  amount: number;
  subcategory_name: string | null;
  subcategory_color: string | null;
  category_name: string | null;
  category_color: string | null;
}

interface CategoryGroupRow {
  category_id: string;
  category_name: string;
  category_type: string;
  category_color: string | null;
  subcategory_id: string;
  subcategory_name: string;
  subcategory_color: string | null;
  total: number;
  monthly_goal: number | null;
}

interface MetricsRow {
  totalIncome: number;
  totalExpenses: number;
}

interface NetWorthRow {
  account_type: string;
  total: number;
}

interface TagSummaryRow {
  tag_id: string;
  tag_name: string;
  tag_type: string;
  tag_color: string | null;
  expense_total: number;
  income_total: number;
  net_total: number;
  transaction_count: number;
}

interface TagCategorySummaryRow extends TagSummaryRow {
  category_id: string | null;
  category_name: string | null;
  category_type: string | null;
  category_color: string | null;
}

function buildTagFilterClause(
  transactionAlias: string,
  tagIds?: string[],
): { clause: string; params: unknown[] } {
  const filter = buildTagExistsClause(tagIds, `${transactionAlias}.id`);
  return {
    clause: filter.clause ? `AND ${filter.clause}` : "",
    params: filter.params,
  };
}

function prorateMonthlyGoal(
  monthlyGoal: number,
  startDate: string,
  endDate: string,
): number {
  const rangeStart = parseIsoDate(startDate);
  const rangeEnd = parseIsoDate(endDate);
  let monthStart = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1));
  let total = 0;

  while (monthStart <= rangeEnd) {
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
    const overlapStart = rangeStart > monthStart ? rangeStart : monthStart;
    const overlapEnd = rangeEnd < monthEnd ? rangeEnd : monthEnd;

    if (overlapStart <= overlapEnd) {
      const elapsedDays = differenceInCalendarDaysUtc(overlapEnd, overlapStart) + 1;
      const daysInMonth = differenceInCalendarDaysUtc(monthEnd, monthStart) + 1;
      total += (monthlyGoal * elapsedDays) / daysInMonth;
    }

    monthStart = addMonthsUtc(monthStart, 1);
  }

  return total;
}

// Income as a positive net-worth effect, expenses as a negative one, whatever
// the account type (liability purchases are stored positive, refunds negative).
const EFFECT = netWorthEffectSql("t.amount", "a.type");
const INCOME_TOTAL = `COALESCE(SUM(CASE WHEN t.kind = 'income' THEN ${EFFECT} ELSE 0 END), 0)`;
const EXPENSE_TOTAL = `COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN -${EFFECT} ELSE 0 END), 0)`;

// === Dashboard Functions ===

export function getAccountSummary(
  startDate: string,
  endDate: string,
): { accounts: AccountSummary[]; netWorth: NetWorthSummary } {
  const db = getDb();
  const effectiveStartDate = clampStartDateToFirstTransaction(
    startDate,
    endDate,
  );

  const accounts = db
    .prepare(
      `SELECT id, name, type, initial_balance, color FROM accounts WHERE deleted_at IS NULL ORDER BY created_at`,
    )
    .all() as AccountRow[];

  const startingBalanceStmt = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS starting_balance
     FROM transactions
     WHERE account_id = ? AND date < ? AND deleted_at IS NULL`,
  );
  const rangeTransactionsStmt = db.prepare(
    `SELECT t.id, t.date, t.name, t.amount,
            s.name AS subcategory_name,
            s.color AS subcategory_color,
            c.name AS category_name,
            c.color AS category_color
     FROM transactions t
     LEFT JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
     LEFT JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     WHERE t.account_id = ? AND t.date >= ? AND t.date <= ? AND t.deleted_at IS NULL
     ORDER BY t.date, t.created_at`,
  );

  const summaries: AccountSummary[] = accounts.map((account) => {
    const balanceRow = startingBalanceStmt.get(account.id, effectiveStartDate) as BalanceRow;
    const startingBalance =
      account.initial_balance + balanceRow.starting_balance;
    const transactions = rangeTransactionsStmt.all(
      account.id,
      effectiveStartDate,
      endDate,
    ) as TransactionRow[];

    // Build transactions with running balance
    let runningBalance = startingBalance;
    const accountTransactions: AccountTransaction[] = transactions.map(
      (txn) => {
        runningBalance += txn.amount;
        return {
          id: txn.id,
          date: txn.date,
          name: txn.name,
          amount: txn.amount,
          running_balance: runningBalance,
          subcategory_name: txn.subcategory_name,
          subcategory_color: txn.subcategory_color,
          category_name: txn.category_name,
          category_color: txn.category_color,
        };
      },
    );

    const totalChange = transactions.reduce((sum, t) => sum + t.amount, 0);

    return {
      account_id: account.id,
      account_name: account.name,
      account_type: account.type as AccountType,
      account_color: account.color,
      starting_balance: startingBalance,
      total_change: totalChange,
      ending_balance: startingBalance + totalChange,
      transactions: accountTransactions,
    };
  });

  const netWorth = calculateNetWorth(endDate);

  return { accounts: summaries, netWorth };
}

export function getCategorySummary(
  startDate: string,
  endDate: string,
  tagIds?: string[],
): CategorySummary[] {
  const db = getDb();
  const effectiveStartDate = clampStartDateToFirstTransaction(
    startDate,
    endDate,
  );
  const tagFilter = buildTagFilterClause("t", tagIds);

  const rows = db
    .prepare(
      `SELECT
       c.id AS category_id,
       c.name AS category_name,
       c.type AS category_type,
       c.color AS category_color,
       s.id AS subcategory_id,
       s.name AS subcategory_name,
       s.color AS subcategory_color,
       COALESCE(SUM(t.effect), 0) AS total,
       s.monthly_goal
     FROM categories c
     JOIN subcategories s ON s.category_id = c.id AND s.deleted_at IS NULL
     LEFT JOIN (
       SELECT t.subcategory_id, t.kind, ${EFFECT} AS effect
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
       WHERE t.date >= ? AND t.date <= ? AND t.deleted_at IS NULL
         ${tagFilter.clause}
     ) t ON t.subcategory_id = s.id AND t.kind = c.type
     WHERE c.deleted_at IS NULL
     GROUP BY c.id, s.id
     ORDER BY c.type, c.name, s.name`,
    )
    .all(
      effectiveStartDate,
      endDate,
      ...tagFilter.params,
    ) as CategoryGroupRow[];

  // Group by category
  const categoryMap = new Map<string, CategorySummary>();

  for (const row of rows) {
    let category = categoryMap.get(row.category_id);
    if (!category) {
      category = {
        category_id: row.category_id,
        category_name: row.category_name,
        category_type: row.category_type as CategoryType,
        category_color: row.category_color,
        total: 0,
        goal: null,
        difference: null,
        subcategories: [],
      };
      categoryMap.set(row.category_id, category);
    }

    const scaledGoal =
      row.monthly_goal != null
        ? prorateMonthlyGoal(row.monthly_goal, effectiveStartDate, endDate)
        : null;

    const subcategory: SubcategorySummary = {
      subcategory_id: row.subcategory_id,
      subcategory_name: row.subcategory_name,
      subcategory_color: row.subcategory_color,
      total: row.total,
      goal: scaledGoal,
      difference: scaledGoal != null ? scaledGoal - Math.abs(row.total) : null,
    };

    category.subcategories.push(subcategory);
    category.total += row.total;

    if (scaledGoal != null) {
      category.goal = (category.goal ?? 0) + scaledGoal;
    }
  }

  // Compute category-level difference
  for (const category of categoryMap.values()) {
    if (category.goal != null) {
      category.difference = category.goal - Math.abs(category.total);
    }
  }

  return Array.from(categoryMap.values());
}

export function getDashboardMetrics(
  startDate: string,
  endDate: string,
  tagIds?: string[],
): DashboardMetrics {
  const db = getDb();
  const effectiveStartDate = clampStartDateToFirstTransaction(
    startDate,
    endDate,
  );
  const tagFilter = buildTagFilterClause("t", tagIds);

  const row = db
    .prepare(
      `SELECT
       ${INCOME_TOTAL} AS totalIncome,
       ${EXPENSE_TOTAL} AS totalExpenses
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
     WHERE t.date >= ? AND t.date <= ? AND t.deleted_at IS NULL
       ${tagFilter.clause}`,
    )
    .get(effectiveStartDate, endDate, ...tagFilter.params) as MetricsRow;

  return {
    totalIncome: row.totalIncome,
    totalExpenses: row.totalExpenses,
    netChange: row.totalIncome - row.totalExpenses,
  };
}

export function getTagSummary(
  startDate: string,
  endDate: string,
  tagIds?: string[],
): TagSummary[] {
  const db = getDb();
  const effectiveStartDate = clampStartDateToFirstTransaction(
    startDate,
    endDate,
  );
  const selectedTagClause =
    tagIds && tagIds.length > 0
      ? `AND tag.id IN (${tagIds.map(() => "?").join(", ")})`
      : "";
  const selectedTagParams = tagIds && tagIds.length > 0 ? tagIds : [];

  const summaryRows = db
    .prepare(
      `SELECT
        tag.id AS tag_id,
        tag.name AS tag_name,
        tag.type AS tag_type,
        tag.color AS tag_color,
        ${EXPENSE_TOTAL} AS expense_total,
        ${INCOME_TOTAL} AS income_total,
        ${INCOME_TOTAL} - ${EXPENSE_TOTAL} AS net_total,
        COUNT(DISTINCT t.id) AS transaction_count
       FROM tags tag
       JOIN transaction_tags tt ON tt.tag_id = tag.id
       JOIN transactions t ON t.id = tt.transaction_id AND t.deleted_at IS NULL
       JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
       WHERE tag.deleted_at IS NULL
         AND t.date >= ? AND t.date <= ?
         ${selectedTagClause}
       GROUP BY tag.id
       ORDER BY lower(tag.name), tag.type`,
    )
    .all(effectiveStartDate, endDate, ...selectedTagParams) as TagSummaryRow[];

  const categoryRows = db
    .prepare(
      `SELECT
        tag.id AS tag_id,
        tag.name AS tag_name,
        tag.type AS tag_type,
        tag.color AS tag_color,
        c.id AS category_id,
        c.name AS category_name,
        c.type AS category_type,
        c.color AS category_color,
        ${EXPENSE_TOTAL} AS expense_total,
        ${INCOME_TOTAL} AS income_total,
        ${INCOME_TOTAL} - ${EXPENSE_TOTAL} AS net_total,
        COUNT(DISTINCT t.id) AS transaction_count
       FROM tags tag
       JOIN transaction_tags tt ON tt.tag_id = tag.id
       JOIN transactions t ON t.id = tt.transaction_id AND t.deleted_at IS NULL
       JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
       LEFT JOIN subcategories s ON s.id = t.subcategory_id AND s.deleted_at IS NULL
       LEFT JOIN categories c ON c.id = s.category_id AND c.deleted_at IS NULL
       WHERE tag.deleted_at IS NULL
         AND t.date >= ? AND t.date <= ?
         ${selectedTagClause}
       GROUP BY tag.id, c.id
       ORDER BY lower(tag.name), c.name`,
    )
    .all(
      effectiveStartDate,
      endDate,
      ...selectedTagParams,
    ) as TagCategorySummaryRow[];

  const categoriesByTagId = new Map<string, TagSummary["categories"]>();
  for (const row of categoryRows) {
    const categories = categoriesByTagId.get(row.tag_id) ?? [];
    categories.push({
      category_id: row.category_id,
      category_name: row.category_name,
      category_type:
        row.category_type as TagSummary["categories"][number]["category_type"],
      category_color: row.category_color,
      expense_total: row.expense_total,
      income_total: row.income_total,
      net_total: row.net_total,
      transaction_count: row.transaction_count,
    });
    categoriesByTagId.set(row.tag_id, categories);
  }

  return summaryRows.map((row) => ({
    tag_id: row.tag_id,
    tag_name: row.tag_name,
    tag_type: row.tag_type as TagSummary["tag_type"],
    tag_color: row.tag_color,
    expense_total: row.expense_total,
    income_total: row.income_total,
    net_total: row.net_total,
    transaction_count: row.transaction_count,
    categories: categoriesByTagId.get(row.tag_id) ?? [],
  }));
}

export function calculateNetWorth(atDate: string): NetWorthSummary {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT account_type, COALESCE(SUM(balance), 0) AS total
     FROM (
       SELECT a.type AS account_type,
              a.initial_balance + COALESCE(SUM(t.amount), 0) AS balance
       FROM accounts a
       LEFT JOIN transactions t
         ON t.account_id = a.id
         AND t.date <= ?
         AND t.deleted_at IS NULL
       WHERE a.deleted_at IS NULL
       GROUP BY a.id
     )
     GROUP BY account_type`,
    )
    .all(atDate) as NetWorthRow[];

  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const row of rows) {
    if (row.account_type === "asset") {
      totalAssets = row.total;
    } else if (row.account_type === "liability") {
      totalLiabilities = row.total;
    }
  }

  return {
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    net_worth: totalAssets - totalLiabilities,
  };
}
