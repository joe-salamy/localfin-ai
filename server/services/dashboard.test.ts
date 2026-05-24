import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { closeDbForTests } from "../db/index.js";
import { createAccount } from "./accounts.js";
import { createCategory, createSubcategory } from "./categories.js";
import { createTransaction } from "./transactions.js";
import { getAccountSummary, getCategorySummary, getDashboardMetrics } from "./dashboard.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const tempRoots: string[] = [];

function restoreEnvironment(): void {
  if (originalDbPath === undefined) {
    delete process.env.LOCALFIN_DB_PATH;
  } else {
    process.env.LOCALFIN_DB_PATH = originalDbPath;
  }
}

async function useIsolatedDb(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-dashboard-test-"));
  tempRoots.push(tempDir);
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("dashboard excludes adjustments from income and expense reporting while balances include them", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Brokerage Dashboard", type: "asset" });
  const income = createCategory({ name: "Dashboard Income", type: "income" });
  const expense = createCategory({ name: "Dashboard Expense", type: "expense" });
  const paycheck = createSubcategory({ category_id: income.id, name: "Paycheck" });
  const groceries = createSubcategory({ category_id: expense.id, name: "Groceries" });

  createTransaction({
    account_id: account.id,
    date: "2026-05-01",
    name: "Paycheck",
    amount: 1000,
    kind: "income",
    subcategory_id: paycheck.id,
  });
  createTransaction({
    account_id: account.id,
    date: "2026-05-02",
    name: "Groceries",
    amount: -100,
    kind: "expense",
    subcategory_id: groceries.id,
  });
  createTransaction({
    account_id: account.id,
    date: "2026-05-03",
    name: "Appreciation",
    amount: 250,
    kind: "adjustment",
  });

  const metrics = getDashboardMetrics("2026-05-01", "2026-05-31");
  assert.deepEqual(metrics, {
    totalIncome: 1000,
    totalExpenses: -100,
    netChange: 900,
  });

  const categorySummary = getCategorySummary("2026-05-01", "2026-05-31");
  assert.equal(categorySummary.find((category) => category.category_id === income.id)?.total, 1000);
  assert.equal(categorySummary.find((category) => category.category_id === expense.id)?.total, -100);

  const accountSummary = getAccountSummary("2026-05-01", "2026-05-31");
  assert.equal(accountSummary.accounts[0]?.ending_balance, 1150);
  assert.equal(accountSummary.netWorth.net_worth, 1150);
});
