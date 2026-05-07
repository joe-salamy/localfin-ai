import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { recentActivityByAccountSql } from "./transactions.js";

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

function createRecentActivityDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
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
    "INSERT INTO accounts (id, name, type, deleted_at) VALUES (?, ?, ?, ?)",
  ).run("checking", "Checking", "asset", null);
  db.prepare(
    "INSERT INTO accounts (id, name, type, deleted_at) VALUES (?, ?, ?, ?)",
  ).run("empty", "Empty", "asset", null);
  db.prepare(
    "INSERT INTO accounts (id, name, type, deleted_at) VALUES (?, ?, ?, ?)",
  ).run("closed", "Closed", "asset", "2026-05-01T00:00:00.000Z");

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
      current_balance: 65,
      last_transaction_id: "same-tie-second",
      last_transaction_date: "2026-05-01",
      last_transaction_name: "Second same timestamp",
      last_transaction_amount: -10,
    },
    {
      account_id: "empty",
      account_name: "Empty",
      account_type: "asset",
      current_balance: 0,
      last_transaction_id: null,
      last_transaction_date: null,
      last_transaction_name: null,
      last_transaction_amount: null,
    },
  ]);

  db.close();
});
