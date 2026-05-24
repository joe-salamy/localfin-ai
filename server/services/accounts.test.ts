import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { closeDbForTests, getDb } from "../db/index.js";
import { createAccount, getAccountsWithBalances, updateAccount } from "./accounts.js";
import { createTransaction, getTransactions } from "./transactions.js";

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

test("createAccount stores initial balance without creating a transaction", async () => {
  await useIsolatedDb();

  const account = createAccount({
    name: "Initial Balance Checking",
    type: "asset",
    initial_balance: 500,
  });

  assert.equal(account.initial_balance, 500);
  assert.deepEqual(getTransactions({ accountId: account.id }), []);

  const withBalance = getAccountsWithBalances().find((item) => item.id === account.id);
  assert.equal(withBalance?.current_balance, 500);
});

test("updateAccount mutates initial balance and current balance uses later transactions", async () => {
  await useIsolatedDb();

  const account = createAccount({
    name: "Mutable Balance Brokerage",
    type: "asset",
    initial_balance: 100,
  });
  createTransaction({
    account_id: account.id,
    date: "2026-05-01",
    name: "Deposit",
    amount: 25,
    kind: "income",
  });

  const updated = updateAccount(account.id, { initial_balance: 1000 });

  assert.equal(updated.initial_balance, 1000);
  const withBalance = getAccountsWithBalances().find((item) => item.id === account.id);
  assert.equal(withBalance?.current_balance, 1025);

  const db = getDb();
  const initialBalanceRows = db
    .prepare("SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND lower(trim(name)) = 'initial balance'")
    .get(account.id) as { count: number };
  assert.equal(initialBalanceRows.count, 0);
});
