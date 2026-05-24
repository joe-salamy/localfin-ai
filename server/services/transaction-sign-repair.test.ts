import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  applyTransactionSignRepairs,
  findTransactionSignRepairs,
} from "../../scripts/repair-account-type-transaction-signs.js";

function createRepairDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL,
      subcategory_id TEXT,
      is_initial_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  return db;
}

test("transaction sign repair identifies and applies account-type fixes", () => {
  const db = createRepairDb();
  db.prepare("INSERT INTO accounts (id, name, type, deleted_at) VALUES (?, ?, ?, NULL)")
    .run("checking", "Repair Checking", "asset");
  db.prepare("INSERT INTO accounts (id, name, type, deleted_at) VALUES (?, ?, ?, NULL)")
    .run("card", "Repair Card", "liability");
  db.prepare("INSERT INTO categories (id, name, type, deleted_at) VALUES (?, ?, ?, NULL)")
    .run("expense", "Repair Expense", "expense");
  db.prepare("INSERT INTO categories (id, name, type, deleted_at) VALUES (?, ?, ?, NULL)")
    .run("income", "Repair Income", "income");
  db.prepare("INSERT INTO subcategories (id, category_id, name, deleted_at) VALUES (?, ?, ?, NULL)")
    .run("coffee", "expense", "Repair Coffee");
  db.prepare("INSERT INTO subcategories (id, category_id, name, deleted_at) VALUES (?, ?, ?, NULL)")
    .run("payment", "income", "Repair Payment");

  const insertTransaction = db.prepare(`
    INSERT INTO transactions
      (id, account_id, date, name, amount, kind, subcategory_id, is_initial_balance, created_at, updated_at, deleted_at)
    VALUES (?, ?, '2026-05-01', ?, ?, ?, ?, ?, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', NULL)
  `);
  insertTransaction.run("card-charge", "card", "Card charge", -5, "expense", "coffee", 0);
  insertTransaction.run("card-income-kind", "card", "Card categorized charge", 7, "income", "coffee", 0);
  insertTransaction.run("card-payment", "card", "Mobile Payment Thank You", 10, "income", "payment", 0);
  insertTransaction.run("card-payment-expense-category", "card", "Internet Payment Thank You", 12, "expense", "coffee", 0);
  insertTransaction.run("checking-expense", "checking", "Checking expense", 8, "expense", "coffee", 0);
  insertTransaction.run("checking-conflict", "checking", "Checking income miscategorized", 9, "income", "coffee", 0);
  insertTransaction.run("initial", "card", "Initial balance", 100, "income", null, 1);

  const repairs = findTransactionSignRepairs(db);

  assert.deepEqual(
    repairs.map((repair) => ({
      id: repair.id,
      nextAmount: repair.nextAmount,
      nextKind: repair.nextKind,
    })),
    [
      { id: "card-charge", nextAmount: 5, nextKind: "expense" },
      { id: "card-income-kind", nextAmount: 7, nextKind: "expense" },
      { id: "card-payment", nextAmount: -10, nextKind: "income" },
      { id: "card-payment-expense-category", nextAmount: -12, nextKind: "income" },
      { id: "checking-expense", nextAmount: -8, nextKind: "expense" },
    ],
  );

  applyTransactionSignRepairs(db, repairs);

  const rows = db
    .prepare("SELECT id, amount, kind FROM transactions ORDER BY id")
    .all() as Array<{ id: string; amount: number; kind: string }>;
  assert.deepEqual(rows, [
    { id: "card-charge", amount: 5, kind: "expense" },
    { id: "card-income-kind", amount: 7, kind: "expense" },
    { id: "card-payment", amount: -10, kind: "income" },
    { id: "card-payment-expense-category", amount: -12, kind: "income" },
    { id: "checking-conflict", amount: 9, kind: "income" },
    { id: "checking-expense", amount: -8, kind: "expense" },
    { id: "initial", amount: 100, kind: "income" },
  ]);

  db.close();
});
