import { differenceInDays, parseISO } from 'date-fns';
import { getDb } from '../db/index.js';
import type {
  AccountSummary,
  AccountTransaction,
  AccountType,
  CategorySummary,
  CategoryType,
  DashboardMetrics,
  NetWorthSummary,
  SubcategorySummary,
} from '../../src/types/index.js';

// === Row types for query results ===

interface AccountRow {
  id: string;
  name: string;
  type: string;
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
  category_name: string | null;
}

interface CategoryGroupRow {
  category_id: string;
  category_name: string;
  category_type: string;
  subcategory_id: string;
  subcategory_name: string;
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

// === Dashboard Functions ===

export function getAccountSummary(
  startDate: string,
  endDate: string,
): { accounts: AccountSummary[]; netWorth: NetWorthSummary } {
  const db = getDb();

  const accounts = db.prepare(
    `SELECT id, name, type FROM accounts WHERE deleted_at IS NULL ORDER BY created_at`,
  ).all() as AccountRow[];

  const summaries: AccountSummary[] = accounts.map((account) => {
    // Starting balance: sum of all transactions before startDate
    const balanceRow = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS starting_balance
       FROM transactions
       WHERE account_id = ? AND date < ? AND deleted_at IS NULL`,
    ).get(account.id, startDate) as BalanceRow;

    const startingBalance = balanceRow.starting_balance;

    // Transactions within range
    const transactions = db.prepare(
      `SELECT t.id, t.date, t.name, t.amount,
              s.name AS subcategory_name,
              c.name AS category_name
       FROM transactions t
       LEFT JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
       LEFT JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
       WHERE t.account_id = ? AND t.date >= ? AND t.date <= ? AND t.deleted_at IS NULL
       ORDER BY t.date, t.created_at`,
    ).all(account.id, startDate, endDate) as TransactionRow[];

    // Build transactions with running balance
    let runningBalance = startingBalance;
    const accountTransactions: AccountTransaction[] = transactions.map((txn) => {
      runningBalance += txn.amount;
      return {
        id: txn.id,
        date: txn.date,
        name: txn.name,
        amount: txn.amount,
        running_balance: runningBalance,
        subcategory_name: txn.subcategory_name,
        category_name: txn.category_name,
      };
    });

    const totalChange = transactions.reduce((sum, t) => sum + t.amount, 0);

    return {
      account_id: account.id,
      account_name: account.name,
      account_type: account.type as AccountType,
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
): CategorySummary[] {
  const db = getDb();
  const rangeDays = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;

  const rows = db.prepare(
    `SELECT
       c.id AS category_id,
       c.name AS category_name,
       c.type AS category_type,
       s.id AS subcategory_id,
       s.name AS subcategory_name,
       COALESCE(SUM(t.amount), 0) AS total,
       s.monthly_goal
     FROM categories c
     JOIN subcategories s ON s.category_id = c.id AND s.deleted_at IS NULL
     LEFT JOIN transactions t
       ON t.subcategory_id = s.id
       AND t.date >= ? AND t.date <= ?
       AND t.deleted_at IS NULL
     WHERE c.deleted_at IS NULL
     GROUP BY c.id, s.id
     ORDER BY c.type, c.name, s.name`,
  ).all(startDate, endDate) as CategoryGroupRow[];

  // Group by category
  const categoryMap = new Map<string, CategorySummary>();

  for (const row of rows) {
    let category = categoryMap.get(row.category_id);
    if (!category) {
      category = {
        category_id: row.category_id,
        category_name: row.category_name,
        category_type: row.category_type as CategoryType,
        total: 0,
        goal: null,
        difference: null,
        subcategories: [],
      };
      categoryMap.set(row.category_id, category);
    }

    const scaledGoal = row.monthly_goal != null
      ? (row.monthly_goal / 30.42) * rangeDays
      : null;

    const subcategory: SubcategorySummary = {
      subcategory_id: row.subcategory_id,
      subcategory_name: row.subcategory_name,
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
): DashboardMetrics {
  const db = getDb();

  const row = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) AS totalIncome,
       COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END), 0) AS totalExpenses
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
     WHERE t.date >= ? AND t.date <= ? AND t.deleted_at IS NULL`,
  ).get(startDate, endDate) as MetricsRow;

  return {
    totalIncome: row.totalIncome,
    totalExpenses: row.totalExpenses,
    netChange: row.totalIncome + row.totalExpenses,
  };
}

export function calculateNetWorth(atDate: string): NetWorthSummary {
  const db = getDb();

  const rows = db.prepare(
    `SELECT a.type AS account_type, COALESCE(SUM(t.amount), 0) AS total
     FROM accounts a
     LEFT JOIN transactions t
       ON t.account_id = a.id
       AND t.date <= ?
       AND t.deleted_at IS NULL
     WHERE a.deleted_at IS NULL
     GROUP BY a.type`,
  ).all(atDate) as NetWorthRow[];

  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const row of rows) {
    if (row.account_type === 'asset') {
      totalAssets = row.total;
    } else if (row.account_type === 'liability') {
      totalLiabilities = row.total;
    }
  }

  return {
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    net_worth: totalAssets - totalLiabilities,
  };
}
