import {
  addDays,
  addMonths,
  addWeeks,
  differenceInDays,
  format,
  isBefore,
  parseISO,
} from "date-fns";
import { getDb } from "../db/index.js";
import { DATE_CONFIG } from "../config/app.js";
import { clampStartDateToFirstTransaction } from "./date-ranges.js";
import { resolveEntityColor } from "../../src/lib/colors.js";
import type {
  NetWorthDataPoint,
  SankeyData,
  SankeyLink,
  SankeyNode,
} from "../../src/types/index.js";

// === Row types for query results ===

interface AccountRow {
  id: string;
  name: string;
  type: string;
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

// === Chart Functions ===

export function prepareNetWorthData(
  startDate: string,
  endDate: string,
): NetWorthDataPoint[] {
  const db = getDb();
  const effectiveStartDate = clampStartDateToFirstTransaction(startDate, endDate);
  const start = parseISO(effectiveStartDate);
  const end = parseISO(endDate);
  const totalDays = differenceInDays(end, start);

  // Determine granularity
  let advanceFn: (date: Date, amount: number) => Date;
  let dateFormat: string;

  if (totalDays < 28) {
    advanceFn = addDays;
    dateFormat = DATE_CONFIG.shortMonthDayFormat;
  } else if (totalDays < 180) {
    advanceFn = addWeeks;
    dateFormat = DATE_CONFIG.shortMonthDayFormat;
  } else {
    advanceFn = addMonths;
    dateFormat = DATE_CONFIG.monthYearFormat;
  }

  // Get all non-deleted accounts
  const accounts = db
    .prepare(
      `SELECT id, name, type, color FROM accounts WHERE deleted_at IS NULL ORDER BY created_at`,
    )
    .all() as AccountRow[];

  // Prepare statement for cumulative balance per account up to a given date
  const balanceStmt = db.prepare(
    `SELECT COALESCE(SUM(t.amount), 0) AS balance
     FROM transactions t
     WHERE t.account_id = ? AND t.date <= ? AND t.deleted_at IS NULL`,
  );

  // Generate data points
  const dataPoints: NetWorthDataPoint[] = [];
  let current = start;

  while (
    isBefore(current, end) ||
    format(current, DATE_CONFIG.isoDateFormat) === format(end, DATE_CONFIG.isoDateFormat)
  ) {
    const dateStr = format(current, DATE_CONFIG.isoDateFormat);
    const formattedDate = format(current, dateFormat);

    const point: NetWorthDataPoint = {
      date: dateStr,
      formattedDate,
      netWorth: 0,
      accountColors: Object.fromEntries(
        accounts.map((account) => [account.name, resolveEntityColor(account.id, account.color)]),
      ),
    };

    let netWorth = 0;

    for (const account of accounts) {
      const row = balanceStmt.get(account.id, dateStr) as { balance: number };
      const balance = row.balance;
      point[account.name] = balance;

      if (account.type === "asset") {
        netWorth += balance;
      } else {
        netWorth -= balance;
      }
    }

    point.netWorth = netWorth;
    dataPoints.push(point);

    const next = advanceFn(current, 1);
    if (!isBefore(next, current)) {
      current = next;
    } else {
      break;
    }

    // Ensure we don't go past the end date
    if (
      isBefore(end, current) &&
      format(current, DATE_CONFIG.isoDateFormat) !== format(end, DATE_CONFIG.isoDateFormat)
    ) {
      break;
    }
  }

  return dataPoints;
}

export function prepareSankeyData(
  startDate: string,
  endDate: string,
): SankeyData {
  const db = getDb();
  const effectiveStartDate = clampStartDateToFirstTransaction(startDate, endDate);

  // Get income flows (positive amounts in income categories)
  const incomeRows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, c.color AS category_color,
            s.id AS subcategory_id, s.name AS subcategory_name, s.color AS subcategory_color,
            COALESCE(SUM(t.amount), 0) AS total
     FROM transactions t
     JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
     WHERE c.type = 'income'
       AND t.date >= ? AND t.date <= ?
       AND t.deleted_at IS NULL
     GROUP BY c.id, s.id
     HAVING total > 0
     ORDER BY total DESC`,
    )
    .all(effectiveStartDate, endDate) as CategoryFlowRow[];

  // Get expense flows (negative amounts in expense categories)
  const expenseRows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, c.color AS category_color,
            s.id AS subcategory_id, s.name AS subcategory_name, s.color AS subcategory_color,
            COALESCE(SUM(ABS(t.amount)), 0) AS total
     FROM transactions t
     JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
     WHERE c.type = 'expense'
       AND t.date >= ? AND t.date <= ?
       AND t.deleted_at IS NULL
     GROUP BY c.id, s.id
     HAVING total > 0
     ORDER BY total DESC`,
    )
    .all(effectiveStartDate, endDate) as CategoryFlowRow[];

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const nodeSet = new Set<string>();

  function addNode(id: string, color: string): void {
    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      nodes.push({ id, nodeColor: color });
    }
  }

  function addLabeledNode(id: string, displayName: string, color: string): void {
    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      nodes.push({ id, displayName, nodeColor: color });
    }
  }

  // Calculate totals
  let totalIncome = 0;
  let totalExpenses = 0;

  const incomeCategoryTotals = new Map<string, { name: string; total: number }>();
  for (const row of incomeRows) {
    totalIncome += row.total;
    const categoryId = `income-category:${row.category_id}`;
    const previous = incomeCategoryTotals.get(categoryId);
    incomeCategoryTotals.set(categoryId, {
      name: row.category_name,
      total: (previous?.total ?? 0) + row.total,
    });
  }

  const expenseCategoryTotals = new Map<string, { name: string; total: number }>();
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
  addNode("Total Income", "#676767");
  addNode("Total Expenses", "#676767");

  // Income subcategories -> Income categories -> Total Income
  for (const row of incomeRows) {
    const subId = `${row.subcategory_name} (income)`;
    const categoryId = `income-category:${row.category_id}`;
    addLabeledNode(
      subId,
      row.subcategory_name,
      resolveEntityColor(row.subcategory_id, row.subcategory_color),
    );
    addLabeledNode(
      categoryId,
      row.category_name,
      resolveEntityColor(row.category_id, row.category_color),
    );
    links.push({ source: subId, target: categoryId, value: row.total });
  }

  for (const [categoryId, category] of incomeCategoryTotals) {
    links.push({ source: categoryId, target: "Total Income", value: category.total });
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
    addNode("Savings", "#090088");
    links.push({ source: "Total Income", target: "Savings", value: savings });
  }

  // Total Expenses -> Expense categories -> Expense subcategories
  for (const [categoryId, category] of expenseCategoryTotals) {
    const categoryRow = expenseRows.find((row) => `expense-category:${row.category_id}` === categoryId);
    addLabeledNode(
      categoryId,
      category.name,
      categoryRow
        ? resolveEntityColor(categoryRow.category_id, categoryRow.category_color)
        : "#6b3434",
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
    addLabeledNode(
      subId,
      row.subcategory_name,
      resolveEntityColor(row.subcategory_id, row.subcategory_color),
    );
    links.push({ source: categoryId, target: subId, value: row.total });
  }

  return { nodes, links };
}
