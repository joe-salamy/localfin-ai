import assert from "node:assert/strict";
import test from "node:test";
import { createAccount } from "../accounts.js";
import { createCategory, createSubcategory } from "../categories.js";
import { createTransaction } from "./create.js";
import { getRecentTransactionByNameAndAccount } from "./read.js";
import { useTempDatabase } from "../../tests/helpers.js";


function fixture() {
  const account = createAccount({ name: "Checking", type: "asset" });
  const otherAccount = createAccount({ name: "Savings", type: "asset" });
  const category = createCategory({ name: "Food", type: "expense" });
  const groceries = createSubcategory({ name: "Groceries", category_id: category.id });
  const restaurants = createSubcategory({ name: "Restaurants", category_id: category.id });
  const gas = createSubcategory({ name: "Gas", category_id: category.id });
  const coffee = createSubcategory({ name: "Coffee", category_id: category.id });
  return { account, otherAccount, groceries, restaurants, gas, coffee };
}

function seed(opts: {
  name: string;
  accountId: string;
  date: string;
  subcategoryId?: string | null;
  kind?: "expense" | "transfer";
}): void {
  createTransaction({
    account_id: opts.accountId,
    date: opts.date,
    name: opts.name,
    amount: 10,
    kind: opts.kind ?? "expense",
    subcategory_id: opts.subcategoryId ?? null,
  });
}

void test("lookup returns the majority subcategory even when the most recent row differs", async (t) => {
  await useTempDatabase(t);
  const { account, groceries, restaurants } = fixture();
  const name = "MODE MERCHANT";
  seed({ name, accountId: account.id, date: "2026-01-01", subcategoryId: groceries.id });
  seed({ name, accountId: account.id, date: "2026-01-02", subcategoryId: groceries.id });
  seed({ name, accountId: account.id, date: "2026-01-03", subcategoryId: groceries.id });
  seed({ name, accountId: account.id, date: "2026-01-04", subcategoryId: groceries.id });
  seed({ name, accountId: account.id, date: "2026-01-05", subcategoryId: restaurants.id });

  const hit = getRecentTransactionByNameAndAccount(name, account.id);
  assert.equal(hit?.subcategory_id, groceries.id);
});

void test("lookup returns null for high-entropy names", async (t) => {
  await useTempDatabase(t);
  const { account, groceries, restaurants, gas, coffee } = fixture();
  const name = "NOISY MERCHANT";
  seed({ name, accountId: account.id, date: "2026-01-01", subcategoryId: groceries.id });
  seed({ name, accountId: account.id, date: "2026-01-02", subcategoryId: restaurants.id });
  seed({ name, accountId: account.id, date: "2026-01-03", subcategoryId: gas.id });
  seed({ name, accountId: account.id, date: "2026-01-04", subcategoryId: coffee.id });

  assert.equal(getRecentTransactionByNameAndAccount(name, account.id), null);
});

void test("lookup returns null on an even split below confidence", async (t) => {
  await useTempDatabase(t);
  const { account, groceries, restaurants } = fixture();
  const name = "SPLIT MERCHANT";
  seed({ name, accountId: account.id, date: "2026-01-01", subcategoryId: groceries.id });
  seed({ name, accountId: account.id, date: "2026-01-02", subcategoryId: groceries.id });
  seed({ name, accountId: account.id, date: "2026-01-03", subcategoryId: restaurants.id });
  seed({ name, accountId: account.id, date: "2026-01-04", subcategoryId: restaurants.id });

  assert.equal(getRecentTransactionByNameAndAccount(name, account.id), null);
});

void test("lookup falls back to the most recent row with fewer than 3 samples", async (t) => {
  await useTempDatabase(t);
  const { account, groceries, restaurants } = fixture();
  const name = "NEW MERCHANT";
  seed({ name, accountId: account.id, date: "2026-01-01", subcategoryId: groceries.id });
  seed({ name, accountId: account.id, date: "2026-01-02", subcategoryId: restaurants.id });

  const hit = getRecentTransactionByNameAndAccount(name, account.id);
  assert.equal(hit?.subcategory_id, restaurants.id);
});

void test("lookup returns null with no history and stays account-scoped", async (t) => {
  await useTempDatabase(t);
  const { account, otherAccount, groceries } = fixture();
  assert.equal(getRecentTransactionByNameAndAccount("GHOST MERCHANT", account.id), null);

  seed({ name: "SCOPED MERCHANT", accountId: account.id, date: "2026-01-01", subcategoryId: groceries.id });
  seed({ name: "SCOPED MERCHANT", accountId: account.id, date: "2026-01-02", subcategoryId: groceries.id });
  seed({ name: "SCOPED MERCHANT", accountId: account.id, date: "2026-01-03", subcategoryId: groceries.id });
  assert.equal(getRecentTransactionByNameAndAccount("SCOPED MERCHANT", otherAccount.id), null);
});

void test("lookup returns the transfer row when transfers are the confident majority", async (t) => {
  await useTempDatabase(t);
  const { account, groceries } = fixture();
  const name = "TRANSFER MERCHANT";
  seed({ name, accountId: account.id, date: "2026-01-01", kind: "transfer" });
  seed({ name, accountId: account.id, date: "2026-01-02", kind: "transfer" });
  seed({ name, accountId: account.id, date: "2026-01-03", kind: "transfer" });
  seed({ name, accountId: account.id, date: "2026-01-04", subcategoryId: groceries.id });

  const hit = getRecentTransactionByNameAndAccount(name, account.id);
  assert.equal(hit?.kind, "transfer");
  assert.equal(hit?.subcategory_id, null);
});
