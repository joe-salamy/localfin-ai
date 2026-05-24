import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import Database from "better-sqlite3";
import { closeDbForTests, getDb, resolveDatabasePath } from "./index.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const originalDataDir = process.env.LOCALFIN_DATA_DIR;
const tempRoots: string[] = [];

function restoreEnvironment(): void {
  if (originalDbPath === undefined) {
    delete process.env.LOCALFIN_DB_PATH;
  } else {
    process.env.LOCALFIN_DB_PATH = originalDbPath;
  }

  if (originalDataDir === undefined) {
    delete process.env.LOCALFIN_DATA_DIR;
  } else {
    process.env.LOCALFIN_DATA_DIR = originalDataDir;
  }
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("resolveDatabasePath trims an explicit database path override", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-db-path-test-"));
  tempRoots.push(tempDir);
  const expectedPath = path.join(tempDir, "custom.db");

  process.env.LOCALFIN_DB_PATH = `  ${expectedPath}  `;
  process.env.LOCALFIN_DATA_DIR = path.join(tempDir, "ignored");

  assert.equal(resolveDatabasePath(), expectedPath);
});

test("resolveDatabasePath trims the data directory override", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-data-dir-test-"));
  tempRoots.push(tempDir);
  delete process.env.LOCALFIN_DB_PATH;
  process.env.LOCALFIN_DATA_DIR = `  ${tempDir}  `;

  assert.equal(resolveDatabasePath(), path.join(tempDir, "budget.db"));
});

test("closeDbForTests allows getDb to reopen at a new isolated path", async () => {
  const firstDir = await mkdtemp(path.join(os.tmpdir(), "localfin-first-db-test-"));
  const secondDir = await mkdtemp(path.join(os.tmpdir(), "localfin-second-db-test-"));
  tempRoots.push(firstDir, secondDir);

  const firstPath = path.join(firstDir, "budget.db");
  const secondPath = path.join(secondDir, "budget.db");

  process.env.LOCALFIN_DB_PATH = firstPath;
  getDb().prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, ?)").run(
    "first-account",
    "First Account",
    "asset",
  );

  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = secondPath;
  await mkdir(secondDir, { recursive: true });
  const secondDb = getDb();
  const firstAccount = secondDb
    .prepare("SELECT 1 FROM accounts WHERE id = ?")
    .get("first-account");

  assert.equal(firstAccount, undefined);
});

test("getDb migrates existing entity tables to include nullable colors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-color-migration-test-"));
  tempRoots.push(tempDir);
  const dbPath = path.join(tempDir, "budget.db");

  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      monthly_goal REAL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  legacyDb.prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, ?)").run(
    "legacy-account",
    "Legacy Account",
    "asset",
  );
  legacyDb.prepare("INSERT INTO categories (id, name, type) VALUES (?, ?, ?)").run(
    "legacy-category",
    "Legacy Category",
    "expense",
  );
  legacyDb.prepare("INSERT INTO subcategories (id, category_id, name) VALUES (?, ?, ?)").run(
    "legacy-subcategory",
    "legacy-category",
    "Legacy Subcategory",
  );
  legacyDb.close();

  process.env.LOCALFIN_DB_PATH = dbPath;
  const migratedDb = getDb();

  for (const table of ["accounts", "categories", "subcategories"]) {
    const columns = migratedDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === "color"), `${table} should include color`);
  }

  const row = migratedDb
    .prepare("SELECT name, color FROM accounts WHERE id = ?")
    .get("legacy-account") as { name: string; color: string | null };

  assert.deepEqual(row, { name: "Legacy Account", color: null });
});

test("getDb migrates active initial balance transactions into accounts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-initial-balance-migration-test-"));
  tempRoots.push(tempDir);
  const dbPath = path.join(tempDir, "budget.db");

  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL DEFAULT 'expense',
      subcategory_id TEXT,
      comment TEXT,
      is_initial_balance INTEGER NOT NULL DEFAULT 0,
      ai_suggested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
  `);
  legacyDb.prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, ?)").run(
    "brokerage",
    "Brokerage",
    "asset",
  );
  legacyDb.prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, ?)").run(
    "checking",
    "Checking",
    "asset",
  );
  const insertTransaction = legacyDb.prepare(
    "INSERT INTO transactions (id, account_id, date, name, amount, kind, is_initial_balance, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insertTransaction.run("named", "brokerage", "2026-05-06", "Initial Balance", 250, "income", 0, null);
  insertTransaction.run("flagged", "brokerage", "2026-05-07", "Opening cash", 75, "income", 1, null);
  insertTransaction.run("regular", "brokerage", "2026-05-08", "Deposit", 25, "income", 0, null);
  insertTransaction.run("deleted", "checking", "2026-05-01", "Initial Balance", 1000, "income", 0, "2026-05-02T00:00:00.000Z");
  legacyDb.close();

  process.env.LOCALFIN_DB_PATH = dbPath;
  let migratedDb = getDb();

  const brokerage = migratedDb
    .prepare("SELECT initial_balance FROM accounts WHERE id = ?")
    .get("brokerage") as { initial_balance: number };
  assert.equal(brokerage.initial_balance, 325);

  const checking = migratedDb
    .prepare("SELECT initial_balance FROM accounts WHERE id = ?")
    .get("checking") as { initial_balance: number };
  assert.equal(checking.initial_balance, 0);

  const remaining = migratedDb
    .prepare("SELECT id FROM transactions ORDER BY id")
    .all() as Array<{ id: string }>;
  assert.deepEqual(remaining.map((row) => row.id), ["deleted", "regular"]);

  closeDbForTests();
  migratedDb = getDb();
  const reopened = migratedDb
    .prepare("SELECT initial_balance FROM accounts WHERE id = ?")
    .get("brokerage") as { initial_balance: number };
  assert.equal(reopened.initial_balance, 325);
});
