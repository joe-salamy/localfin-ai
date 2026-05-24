import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import Database from "better-sqlite3";
import { createAccount } from "./accounts.js";
import { createCategory, createSubcategory } from "./categories.js";
import {
  bulkCreateTransactions,
  bulkUpdateTransactions,
  createTransaction,
  getTransactionById,
  getTransactionsWithDetails,
  recentActivityByAccountSql,
  updateTransaction,
} from "./transactions.js";
import { closeDbForTests } from "../db/index.js";

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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-transactions-test-"));
  tempRoots.push(tempDir);
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface RecentActivityRow {
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

function createRecentActivityDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      initial_balance REAL NOT NULL DEFAULT 0,
      color TEXT,
      deleted_at TEXT
    );

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);

  return db;
}

test("recent activity returns one deterministic latest transaction per active account", () => {
  const db = createRecentActivityDb();

  db.prepare(
    "INSERT INTO accounts (id, name, type, initial_balance, deleted_at) VALUES (?, ?, ?, ?, ?)",
  ).run("checking", "Checking", "asset", 1000, null);
  db.prepare(
    "INSERT INTO accounts (id, name, type, initial_balance, deleted_at) VALUES (?, ?, ?, ?, ?)",
  ).run("empty", "Empty", "asset", 250, null);
  db.prepare(
    "INSERT INTO accounts (id, name, type, initial_balance, deleted_at) VALUES (?, ?, ?, ?, ?)",
  ).run("closed", "Closed", "asset", 500, "2026-05-01T00:00:00.000Z");

  const insertTransaction = db.prepare(
    "INSERT INTO transactions (id, account_id, date, name, amount, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );

  insertTransaction.run(
    "older",
    "checking",
    "2026-04-30",
    "Older deposit",
    100,
    "2026-04-30T12:00:00.000Z",
    null,
  );
  insertTransaction.run(
    "same-tie-first",
    "checking",
    "2026-05-01",
    "First same timestamp",
    -25,
    "2026-05-01T12:00:00.000Z",
    null,
  );
  insertTransaction.run(
    "same-tie-second",
    "checking",
    "2026-05-01",
    "Second same timestamp",
    -10,
    "2026-05-01T12:00:00.000Z",
    null,
  );
  insertTransaction.run(
    "deleted-later",
    "checking",
    "2026-05-02",
    "Deleted later transaction",
    1000,
    "2026-05-02T12:00:00.000Z",
    "2026-05-03T00:00:00.000Z",
  );
  insertTransaction.run(
    "closed-account-transaction",
    "closed",
    "2026-05-02",
    "Closed account transaction",
    50,
    "2026-05-02T12:00:00.000Z",
    null,
  );

  const rows = db.prepare(recentActivityByAccountSql).all() as RecentActivityRow[];

  assert.deepEqual(rows, [
    {
      account_id: "checking",
      account_name: "Checking",
      account_type: "asset",
      account_color: null,
      current_balance: 1065,
      last_transaction_id: "same-tie-second",
      last_transaction_date: "2026-05-01",
      last_transaction_name: "Second same timestamp",
      last_transaction_amount: -10,
    },
    {
      account_id: "empty",
      account_name: "Empty",
      account_type: "asset",
      account_color: null,
      current_balance: 250,
      last_transaction_id: null,
      last_transaction_date: null,
      last_transaction_name: null,
      last_transaction_amount: null,
    },
  ]);

  db.close();
});

test("create transaction normalizes amount signs by account type and kind", async () => {
  await useIsolatedDb();
  const checking = createAccount({ name: "Sign Checking", type: "asset" });
  const creditCard = createAccount({ name: "Sign Credit Card", type: "liability" });

  const checkingExpense = createTransaction({
    account_id: checking.id,
    date: "2026-05-01",
    name: "Checking groceries",
    amount: 75,
    kind: "expense",
  });
  const checkingIncome = createTransaction({
    account_id: checking.id,
    date: "2026-05-02",
    name: "Checking deposit",
    amount: -75,
    kind: "income",
  });
  const creditExpense = createTransaction({
    account_id: creditCard.id,
    date: "2026-05-03",
    name: "Credit charge",
    amount: -75,
    kind: "expense",
  });
  const creditIncome = createTransaction({
    account_id: creditCard.id,
    date: "2026-05-04",
    name: "Credit payment",
    amount: 75,
    kind: "income",
  });
  const transfer = createTransaction({
    account_id: checking.id,
    date: "2026-05-05",
    name: "Transfer",
    amount: 75,
    kind: "transfer",
  });

  assert.equal(checkingExpense.amount, -75);
  assert.equal(checkingIncome.amount, 75);
  assert.equal(creditExpense.amount, 75);
  assert.equal(creditIncome.amount, -75);
  assert.equal(transfer.amount, 75);
});

test("bulk create normalizes amount signs by account type and kind", async () => {
  await useIsolatedDb();
  const checking = createAccount({ name: "Bulk Sign Checking", type: "asset" });
  const creditCard = createAccount({ name: "Bulk Sign Credit Card", type: "liability" });

  const created = bulkCreateTransactions([
    {
      account_id: checking.id,
      date: "2026-05-01",
      name: "Checking expense",
      amount: 12,
      kind: "expense",
    },
    {
      account_id: creditCard.id,
      date: "2026-05-02",
      name: "Credit expense",
      amount: -34,
      kind: "expense",
    },
    {
      account_id: creditCard.id,
      date: "2026-05-03",
      name: "Credit payment",
      amount: 56,
      kind: "income",
    },
  ]);

  const byName = new Map(created.map((transaction) => [transaction.name, transaction]));
  assert.equal(byName.get("Checking expense")?.amount, -12);
  assert.equal(byName.get("Credit expense")?.amount, 34);
  assert.equal(byName.get("Credit payment")?.amount, -56);
});

test("subcategory-only update keeps existing transfers uncategorized", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Transfer Checking", type: "asset" });
  const category = createCategory({ name: "Transfer Test Expense", type: "expense" });
  const subcategory = createSubcategory({
    category_id: category.id,
    name: "Transfer Test Other",
  });
  const transfer = createTransaction({
    account_id: account.id,
    date: "2026-05-01",
    name: "Card payment",
    amount: -100,
    kind: "transfer",
  });

  const updated = updateTransaction(transfer.id, { subcategory_id: subcategory.id });

  assert.equal(updated?.kind, "transfer");
  assert.equal(updated?.subcategory_id, null);
});

test("bulk subcategory update does not attach categories to existing transfers", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Bulk Transfer Checking", type: "asset" });
  const category = createCategory({ name: "Bulk Transfer Expense", type: "expense" });
  const subcategory = createSubcategory({
    category_id: category.id,
    name: "Bulk Transfer Other",
  });
  const transfer = createTransaction({
    account_id: account.id,
    date: "2026-05-01",
    name: "Online transfer",
    amount: -50,
    kind: "transfer",
  });
  const expense = createTransaction({
    account_id: account.id,
    date: "2026-05-02",
    name: "Groceries",
    amount: -25,
    kind: "expense",
  });

  bulkUpdateTransactions([transfer.id, expense.id], { subcategory_id: subcategory.id });

  assert.equal(getTransactionById(transfer.id)?.subcategory_id, null);
  assert.equal(getTransactionById(expense.id)?.subcategory_id, subcategory.id);
});

test("needs category filter excludes transfers after subcategory-only updates", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Needs Category Checking", type: "asset" });
  const transfer = createTransaction({
    account_id: account.id,
    date: "2026-05-01",
    name: "ACH payment",
    amount: -75,
    kind: "transfer",
  });
  const expense = createTransaction({
    account_id: account.id,
    date: "2026-05-02",
    name: "Uncategorized expense",
    amount: -20,
    kind: "expense",
  });

  const matches = getTransactionsWithDetails({ needsCategory: true });

  assert.deepEqual(matches.map((transaction) => transaction.id), [expense.id]);
  assert.equal(getTransactionById(transfer.id)?.subcategory_id, null);
});

test("needs category filter excludes adjustments", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Needs Category Adjustment", type: "asset" });
  const adjustment = createTransaction({
    account_id: account.id,
    date: "2026-05-01",
    name: "Appreciation",
    amount: 25,
    kind: "adjustment",
  });
  const expense = createTransaction({
    account_id: account.id,
    date: "2026-05-02",
    name: "Uncategorized expense",
    amount: -20,
    kind: "expense",
  });

  const matches = getTransactionsWithDetails({ needsCategory: true });

  assert.deepEqual(matches.map((transaction) => transaction.id), [expense.id]);
  assert.equal(getTransactionById(adjustment.id)?.subcategory_id, null);
});

test("multi-select filters use OR within groups and AND across groups", async () => {
  await useIsolatedDb();
  const checking = createAccount({ name: "Multi Checking", type: "asset" });
  const savings = createAccount({ name: "Multi Savings", type: "asset" });
  const credit = createAccount({ name: "Multi Credit", type: "liability" });
  const food = createCategory({ name: "Multi Food", type: "expense" });
  const bills = createCategory({ name: "Multi Bills", type: "expense" });
  const income = createCategory({ name: "Multi Income", type: "income" });
  const groceries = createSubcategory({ category_id: food.id, name: "Multi Groceries" });
  const restaurants = createSubcategory({ category_id: food.id, name: "Multi Restaurants" });
  const utilities = createSubcategory({ category_id: bills.id, name: "Multi Utilities" });
  const paycheck = createSubcategory({ category_id: income.id, name: "Multi Paycheck" });

  const checkingGroceries = createTransaction({
    account_id: checking.id,
    date: "2026-05-01",
    name: "Groceries",
    amount: -45,
    kind: "expense",
    subcategory_id: groceries.id,
  });
  const savingsRestaurants = createTransaction({
    account_id: savings.id,
    date: "2026-05-02",
    name: "Dinner",
    amount: -80,
    kind: "expense",
    subcategory_id: restaurants.id,
  });
  const creditUtilities = createTransaction({
    account_id: credit.id,
    date: "2026-05-03",
    name: "Power",
    amount: -120,
    kind: "expense",
    subcategory_id: utilities.id,
  });
  const checkingPaycheck = createTransaction({
    account_id: checking.id,
    date: "2026-05-04",
    name: "Paycheck",
    amount: 1000,
    kind: "income",
    subcategory_id: paycheck.id,
  });

  const accountMatches = getTransactionsWithDetails({
    accountIds: [checking.id, savings.id],
  });
  assert.deepEqual(
    accountMatches.map((transaction) => transaction.id),
    [checkingPaycheck.id, savingsRestaurants.id, checkingGroceries.id],
  );

  const categoryMatches = getTransactionsWithDetails({
    categoryIds: [food.id, bills.id],
  });
  assert.deepEqual(
    categoryMatches.map((transaction) => transaction.id),
    [creditUtilities.id, savingsRestaurants.id, checkingGroceries.id],
  );

  const subcategoryMatches = getTransactionsWithDetails({
    subcategoryIds: [groceries.id, utilities.id],
  });
  assert.deepEqual(
    subcategoryMatches.map((transaction) => transaction.id),
    [creditUtilities.id, checkingGroceries.id],
  );

  const combinedMatches = getTransactionsWithDetails({
    accountIds: [checking.id, savings.id],
    categoryIds: [food.id],
    subcategoryIds: [groceries.id],
  });
  assert.deepEqual(
    combinedMatches.map((transaction) => transaction.id),
    [checkingGroceries.id],
  );

  const legacyMatches = getTransactionsWithDetails({
    accountId: checking.id,
    subcategoryId: groceries.id,
  });
  assert.deepEqual(
    legacyMatches.map((transaction) => transaction.id),
    [checkingGroceries.id],
  );
});
