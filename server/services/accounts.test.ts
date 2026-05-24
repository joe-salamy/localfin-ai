import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { closeDbForTests } from "../db/index.js";
import { createCategory, createSubcategory } from "./categories.js";
import { createTransaction, getTransactionById, updateTransaction } from "./transactions.js";
import { createAccount, deleteAccount, reconcileAccount } from "./accounts.js";

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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-accounts-test-"));
  tempRoots.push(tempDir);
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("reconcileAccount creates appreciation for positive asset adjustments", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Brokerage", type: "asset", initial_balance: 1000 });

  const result = reconcileAccount(account.id, {
    date: "2026-05-24",
    target_balance: 1250.12,
  });

  assert.equal(result.previous_balance, 1000);
  assert.equal(result.target_balance, 1250.12);
  assert.equal(result.adjustment_amount, 250.12);
  assert.equal(result.transaction?.name, "Appreciation");
  assert.equal(result.transaction?.kind, "adjustment");
  assert.equal(result.transaction?.amount, 250.12);
  assert.equal(result.transaction?.subcategory_id, null);
});

test("reconcileAccount creates depreciation for negative asset adjustments", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Roth IRA", type: "asset", initial_balance: 1000 });

  const result = reconcileAccount(account.id, {
    date: "2026-05-24",
    target_balance: 875,
  });

  assert.equal(result.adjustment_amount, -125);
  assert.equal(result.transaction?.name, "Depreciation");
  assert.equal(result.transaction?.kind, "adjustment");
});

test("reconcileAccount names liability adjustments by balance direction", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Credit Card", type: "liability", initial_balance: 500 });

  const increase = reconcileAccount(account.id, {
    date: "2026-05-24",
    target_balance: 650,
  });
  const decrease = reconcileAccount(account.id, {
    date: "2026-05-25",
    target_balance: 400,
  });

  assert.equal(increase.transaction?.name, "Balance Increase");
  assert.equal(increase.adjustment_amount, 150);
  assert.equal(decrease.transaction?.name, "Balance Decrease");
  assert.equal(decrease.adjustment_amount, -250);
});

test("reconcileAccount uses balance through the selected date", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Taxable Brokerage", type: "asset" });
  createTransaction({
    account_id: account.id,
    date: "2026-05-01",
    name: "Opening value",
    amount: 100,
    kind: "adjustment",
  });
  createTransaction({
    account_id: account.id,
    date: "2026-05-10",
    name: "Deposit",
    amount: 50,
    kind: "transfer",
  });
  createTransaction({
    account_id: account.id,
    date: "2026-05-20",
    name: "Future deposit",
    amount: 1000,
    kind: "transfer",
  });

  const result = reconcileAccount(account.id, {
    date: "2026-05-15",
    target_balance: 200,
  });

  assert.equal(result.previous_balance, 150);
  assert.equal(result.adjustment_amount, 50);
  assert.equal(result.transaction?.date, "2026-05-15");
});

test("reconcileAccount does not create a transaction for zero cent delta", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Matched Account", type: "asset", initial_balance: 100 });

  const result = reconcileAccount(account.id, {
    date: "2026-05-24",
    target_balance: 100.004,
  });

  assert.equal(result.adjustment_amount, 0);
  assert.equal(result.transaction, null);
});

test("reconcileAccount rejects deleted accounts", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Closed Account", type: "asset", initial_balance: 100 });
  deleteAccount(account.id);

  assert.throws(
    () => reconcileAccount(account.id, { date: "2026-05-24", target_balance: 150 }),
    /not found/,
  );
});

test("adjustment transactions remain uncategorized after subcategory updates", async () => {
  await useIsolatedDb();
  const account = createAccount({ name: "Adjustment Account", type: "asset", initial_balance: 100 });
  const category = createCategory({ name: "Adjustment Expenses", type: "expense" });
  const subcategory = createSubcategory({ category_id: category.id, name: "Other" });
  const result = reconcileAccount(account.id, { date: "2026-05-24", target_balance: 120 });
  assert.ok(result.transaction);

  const updated = updateTransaction(result.transaction.id, { subcategory_id: subcategory.id });

  assert.equal(updated?.kind, "adjustment");
  assert.equal(updated?.subcategory_id, null);
  assert.equal(getTransactionById(result.transaction.id)?.subcategory_id, null);
});
