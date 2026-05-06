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
}

interface CategoryFlowRow {
  category_name: string;
  subcategory_name: string;
  total: number;
}

// === Chart Functions ===

export function prepareNetWorthData(
  startDate: string,
  endDate: string,
): NetWorthDataPoint[] {
  const db = getDb();
  const start = parseISO(startDate);
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
      `SELECT id, name, type FROM accounts WHERE deleted_at IS NULL ORDER BY created_at`,
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

  // Get income flows (positive amounts in income categories)
  const incomeRows = db
    .prepare(
      `SELECT c.name AS category_name, s.name AS subcategory_name,
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
    .all(startDate, endDate) as CategoryFlowRow[];

  // Get expense flows (negative amounts in expense categories)
  const expenseRows = db
    .prepare(
      `SELECT c.name AS category_name, s.name AS subcategory_name,
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
    .all(startDate, endDate) as CategoryFlowRow[];

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const nodeSet = new Set<string>();

  function addNode(id: string, color: string): void {
    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      nodes.push({ id, nodeColor: color });
    }
  }

  // Calculate totals
  let totalIncome = 0;
  let totalExpenses = 0;

  const incomeCategoryTotals = new Map<string, number>();
  for (const row of incomeRows) {
    totalIncome += row.total;
    incomeCategoryTotals.set(
      row.category_name,
      (incomeCategoryTotals.get(row.category_name) ?? 0) + row.total,
    );
  }

  const expenseCategoryTotals = new Map<string, number>();
  for (const row of expenseRows) {
    totalExpenses += row.total;
    expenseCategoryTotals.set(
      row.category_name,
      (expenseCategoryTotals.get(row.category_name) ?? 0) + row.total,
    );
  }

  // Add center nodes
  addNode("Total Income", "#676767");
  addNode("Total Expenses", "#676767");

  // Income subcategories -> Income categories -> Total Income
  for (const row of incomeRows) {
    const subId = `${row.subcategory_name} (income)`;
    addNode(subId, "#003804");
    addNode(row.category_name, "#334f35");
    links.push({ source: subId, target: row.category_name, value: row.total });
  }

  for (const [categoryName, total] of incomeCategoryTotals) {
    links.push({ source: categoryName, target: "Total Income", value: total });
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
  for (const [categoryName, total] of expenseCategoryTotals) {
    addNode(categoryName, "#6b3434");
    links.push({
      source: "Total Expenses",
      target: categoryName,
      value: total,
    });
  }

  for (const row of expenseRows) {
    const subId = `${row.subcategory_name} (expense)`;
    addNode(subId, "#6f0000");
    links.push({ source: row.category_name, target: subId, value: row.total });
  }

  return { nodes, links };
}
