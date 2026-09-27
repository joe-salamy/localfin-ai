import {
  addMonthsUtc,
  differenceInCalendarDaysUtc,
  parseIsoDate,
  toIsoDate,
} from "./dates.js";
import { getDb } from "../db/index.js";
import { clampStartDateToFirstTransaction } from "./date-ranges.js";
import { buildTagExistsClause, netWorthEffectSql } from "./transaction-filters.js";
import { resolveEntityColor } from "../../shared/finance/colors.js";
import type { NetWorthChart,
NetWorthDataPoint,
SankeyData,
SankeyLink,
SankeyNode, } from "../../shared/contracts/index.js"

// === Row types for query results ===

interface AccountRow {
  id: string;
  name: string;
  type: string;
  initial_balance: number;
  color: string | null;
}

interface CategoryFlowRow {
  category_id: string;
  category_name: string;
  category_color: string | null;
  subcategory_id: string;
  subcategory_name: string;
  subcategory_color: string | null;
  total: number;
}

function buildSankeyTagFilter(tagIds?: string[]): {
  clause: string;
  params: unknown[];
} {
  const filter = buildTagExistsClause(tagIds);
  return {
    clause: filter.clause ? `AND ${filter.clause}` : "",
    params: filter.params,
  };
}

type DateGranularity = "day" | "week" | "month";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function bucketDates(startDate: string, endDate: string, granularity: DateGranularity): string[] {
  const endIso = toIsoDate(parseIsoDate(endDate));
  const dates: string[] = [];
  let current = parseIsoDate(startDate);
  while (toIsoDate(current) <= endIso) {
    dates.push(toIsoDate(current));
    const next =
      granularity === "day"
        ? new Date(current.getTime() + 86_400_000)
        : granularity === "week"
          ? new Date(current.getTime() + 7 * 86_400_000)
          : addMonthsUtc(current, 1);
    if (next.getTime() <= current.getTime()) break;
    current = next;
  }
  return dates;
}

export function prepareNetWorthData(
  startDate: string,
  endDate: string,
): NetWorthChart {
  const db = getDb();
  const effectiveStartDate = clampStartDateToFirstTransaction(
    startDate,
    endDate,
  );
  const totalDays = differenceInCalendarDaysUtc(parseIsoDate(endDate), parseIsoDate(effectiveStartDate));
  const granularity: DateGranularity = totalDays < 28 ? "day" : totalDays < 180 ? "week" : "month";

  const accounts = db
    .prepare(
      `SELECT id, name, type, initial_balance, color FROM accounts WHERE deleted_at IS NULL ORDER BY created_at`,
    )
    .all() as AccountRow[];
  const transactions = db
    .prepare(
      `SELECT t.account_id, t.date, t.amount
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
       WHERE t.deleted_at IS NULL AND t.date <= ?
       ORDER BY t.date`,
    )
    .all(endDate) as Array<{ account_id: string; date: string; amount: number }>;

  // Sweep transactions once, carrying running per-account balances forward
  // from one bucket date to the next.
  const balances = new Map(accounts.map((account) => [account.id, account.initial_balance]));
  let next = 0;
  const points = bucketDates(effectiveStartDate, endDate, granularity).map((dateStr): NetWorthDataPoint => {
    for (; next < transactions.length && transactions[next].date <= dateStr; next += 1) {
      const txn = transactions[next];
      balances.set(txn.account_id, (balances.get(txn.account_id) ?? 0) + txn.amount);
    }
    const bucketDate = parseIsoDate(dateStr);
    const point: NetWorthDataPoint = {
      date: dateStr,
      formattedDate:
        granularity === "month"
          ? `${MONTH_LABELS[bucketDate.getUTCMonth()]} ${bucketDate.getUTCFullYear()}`
          : `${MONTH_LABELS[bucketDate.getUTCMonth()]} ${bucketDate.getUTCDate()}`,
      netWorth: 0,
      balances: {},
    };
    for (const account of accounts) {
      const balance = balances.get(account.id) ?? 0;
      point.balances[account.name] = balance;
      point.netWorth += account.type === "asset" ? balance : -balance;
    }
    return point;
  });

  return {
    points,
    accountColors: Object.fromEntries(
      accounts.map((account) => [account.name, resolveEntityColor(account.id, account.color)]),
    ),
  };
}

export function prepareSankeyData(
  startDate: string,
  endDate: string,
  tagIds?: string[],
): SankeyData {
  const db = getDb();
  const effectiveStartDate = clampStartDateToFirstTransaction(
    startDate,
    endDate,
  );
  const tagFilter = buildSankeyTagFilter(tagIds);

  // Income flows, as positive net-worth effects
  const incomeRows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, c.color AS category_color,
            s.id AS subcategory_id, s.name AS subcategory_name, s.color AS subcategory_color,
            COALESCE(SUM(${netWorthEffectSql("t.amount", "a.type")}), 0) AS total
     FROM transactions t
     JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
     WHERE c.type = 'income'
       AND t.kind = 'income'
       AND t.date >= ? AND t.date <= ?
       AND t.deleted_at IS NULL
       ${tagFilter.clause}
     GROUP BY c.id, s.id
     HAVING total > 0
     ORDER BY total DESC`,
    )
    .all(effectiveStartDate, endDate, ...tagFilter.params) as CategoryFlowRow[];

  // Expense flows, as positive magnitudes of negative net-worth effects
  const expenseRows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, c.color AS category_color,
            s.id AS subcategory_id, s.name AS subcategory_name, s.color AS subcategory_color,
            COALESCE(SUM(-${netWorthEffectSql("t.amount", "a.type")}), 0) AS total
     FROM transactions t
     JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
     WHERE c.type = 'expense'
       AND t.kind = 'expense'
       AND t.date >= ? AND t.date <= ?
       AND t.deleted_at IS NULL
       ${tagFilter.clause}
     GROUP BY c.id, s.id
     HAVING total > 0
     ORDER BY total DESC`,
    )
    .all(effectiveStartDate, endDate, ...tagFilter.params) as CategoryFlowRow[];

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const nodeSet = new Set<string>();

  function ensureNode(id: string, color: string, displayName?: string): void {
    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      nodes.push(displayName === undefined ? { id, nodeColor: color } : { id, displayName, nodeColor: color });
    }
  }

  // Calculate totals
  let totalIncome = 0;
  let totalExpenses = 0;

  const incomeCategoryTotals = new Map<
    string,
    { name: string; total: number }
  >();
  for (const row of incomeRows) {
    totalIncome += row.total;
    const categoryId = `income-category:${row.category_id}`;
    const previous = incomeCategoryTotals.get(categoryId);
    incomeCategoryTotals.set(categoryId, {
      name: row.category_name,
      total: (previous?.total ?? 0) + row.total,
    });
  }

  const expenseCategoryTotals = new Map<
    string,
    { name: string; total: number }
  >();
  for (const row of expenseRows) {
    totalExpenses += row.total;
    const categoryId = `expense-category:${row.category_id}`;
    const previous = expenseCategoryTotals.get(categoryId);
    expenseCategoryTotals.set(categoryId, {
      name: row.category_name,
      total: (previous?.total ?? 0) + row.total,
    });
  }

  // Add center nodes
  ensureNode("Total Income", "#676767");
  ensureNode("Total Expenses", "#676767");

  // Income subcategories -> Income categories -> Total Income
  for (const row of incomeRows) {
    const subId = `${row.subcategory_name} (income)`;
    const categoryId = `income-category:${row.category_id}`;
    ensureNode(
      subId,
      resolveEntityColor(row.subcategory_id, row.subcategory_color),
      row.subcategory_name,
    );
    ensureNode(
      categoryId,
      resolveEntityColor(row.category_id, row.category_color),
      row.category_name,
    );
    links.push({ source: subId, target: categoryId, value: row.total });
  }

  for (const [categoryId, category] of incomeCategoryTotals) {
    links.push({
      source: categoryId,
      target: "Total Income",
      value: category.total,
    });
  }

  // Total Income -> Total Expenses
  const flowToExpenses = Math.min(totalIncome, totalExpenses);
  if (flowToExpenses > 0) {
    links.push({
      source: "Total Income",
      target: "Total Expenses",
      value: flowToExpenses,
    });
  }

  // Savings node if income > expenses
  if (totalIncome > totalExpenses) {
    const savings = totalIncome - totalExpenses;
    ensureNode("Savings", "#090088");
    links.push({ source: "Total Income", target: "Savings", value: savings });
  }

  // Total Expenses -> Expense categories -> Expense subcategories
  const expenseRowByCategory = new Map(expenseRows.map((row) => [`expense-category:${row.category_id}`, row]));
  for (const [categoryId, category] of expenseCategoryTotals) {
    const categoryRow = expenseRowByCategory.get(categoryId);
    ensureNode(
      categoryId,
      categoryRow
        ? resolveEntityColor(
            categoryRow.category_id,
            categoryRow.category_color,
          )
        : "#6b3434",
      category.name,
    );
    links.push({
      source: "Total Expenses",
      target: categoryId,
      value: category.total,
    });
  }

  for (const row of expenseRows) {
    const subId = `${row.subcategory_name} (expense)`;
    const categoryId = `expense-category:${row.category_id}`;
    ensureNode(
      subId,
      resolveEntityColor(row.subcategory_id, row.subcategory_color),
      row.subcategory_name,
    );
    links.push({ source: categoryId, target: subId, value: row.total });
  }

  return { nodes, links };
}
