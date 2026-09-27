import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { closeDbForTests, getDb } from "../db/index.js";
import {
  createAccount,
  getAccountsWithBalances,
  updateAccount,
} from "../services/accounts.js";
import {
  createCategory,
  createSubcategory,
  getCategories,
  getSubcategories,
  updateCategory,
  updateSubcategory,
} from "../services/categories.js";
import { createTag, getTags, updateTag } from "../services/tags.js";
import {
  bulkCreateTransactions,
  bulkUpdateTransactions,
  createTransaction,
  deleteTransaction,
  getTransactionsWithDetails,
  restoreTransaction,
  updateTransaction,
} from "../services/transactions.js";
import {
  getAccountSummary,
  getCategorySummary,
  getDashboardMetrics,
} from "../services/dashboard.js";
import { parseStatement } from "../services/parser.js";
import {
  localfinBulkCreateTransactionsInputSchema,
  localfinBulkUpdateTransactionsInputSchema,
  localfinCreateAccountInputSchema,
  localfinCreateCategoryInputSchema,
  localfinCreateSubcategoryInputSchema,
  localfinCreateTagInputSchema,
  localfinCreateTransactionInputSchema,
  localfinDashboardInputSchema,
  localfinDeleteTransactionInputSchema,
  localfinParseStatementInputSchema,
  localfinSearchTransactionsInputSchema,
  localfinUpdateAccountInputSchema,
  localfinUpdateCategoryInputSchema,
  localfinUpdateTransactionInputSchema,
} from "./index.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
async function useTempDatabase(
  t: { after: (fn: () => void | Promise<void>) => void },
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-mcp-test-"));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  getDb();
  t.after(async () => {
    closeDbForTests();
    if (originalDbPath === undefined) delete process.env.LOCALFIN_DB_PATH;
    else process.env.LOCALFIN_DB_PATH = originalDbPath;
    await rm(tempDir, { recursive: true, force: true });
  });
}

// Helper to assert Zod validation throws
function expectZodError(fn: () => unknown): void {
  assert.throws(() => fn(), (error: unknown) => {
    assert.ok(error instanceof z.ZodError);
    return true;
  });
}

void test("mcp: localfin_list_accounts success", async (t) => {
  await useTempDatabase(t);
  createAccount({ name: "Checking", type: "asset" });
  const result = getAccountsWithBalances();
  assert.equal(result.length, 1);
  assert.equal(result[0]?.name, "Checking");
});

void test("mcp: localfin_create_account success and validation error", async (t) => {
  await useTempDatabase(t);
  const schema = localfinCreateAccountInputSchema;
  const parsed = schema.parse({ name: "Savings", type: "asset" });
  const account = createAccount(parsed);
  assert.equal(account.name, "Savings");
  expectZodError(() => schema.parse({ name: "", type: "asset" }));
  expectZodError(() => schema.parse({ name: "X", type: "invalid" as never }));
});

void test("mcp: localfin_update_account success and validation error", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const schema = localfinUpdateAccountInputSchema;
  const parsed = schema.parse({ id: account.id, name: "Renamed" });
  const { id, ...updates } = parsed;
  const updated = updateAccount(id, updates);
  assert.equal(updated.name, "Renamed");
  expectZodError(() => schema.parse({ id: "", name: "X" }));
});

void test("mcp: localfin_list_categories and list_subcategories", async (t) => {
  await useTempDatabase(t);
  const category = createCategory({ name: "Food", type: "expense" });
  createSubcategory({ name: "Groceries", category_id: category.id });
  const categories = getCategories();
  const subcategories = getSubcategories();
  assert.ok(categories.some((c) => c.name === "Food"));
  assert.ok(subcategories.some((s) => s.name === "Groceries"));
});

void test("mcp: localfin_create_category success and validation error", async (t) => {
  await useTempDatabase(t);
  const schema = localfinCreateCategoryInputSchema;
  const parsed = schema.parse({ name: "Bills", type: "expense" });
  const category = createCategory(parsed);
  assert.equal(category.name, "Bills");
  expectZodError(() => schema.parse({ name: "", type: "expense" }));
});

void test("mcp: localfin_update_category", async (t) => {
  await useTempDatabase(t);
  const category = createCategory({ name: "Food", type: "expense" });
  const updated = updateCategory(category.id, { name: "Food Updated" });
  assert.equal(updated.name, "Food Updated");
  const schema = localfinUpdateCategoryInputSchema;
  expectZodError(() => schema.parse({ id: "" }));
});

void test("mcp: localfin_create_subcategory success and validation error", async (t) => {
  await useTempDatabase(t);
  const category = createCategory({ name: "Food", type: "expense" });
  const schema = localfinCreateSubcategoryInputSchema;
  const parsed = schema.parse({ name: "Restaurants", category_id: category.id });
  const sub = createSubcategory(parsed);
  assert.equal(sub.name, "Restaurants");
  expectZodError(() => schema.parse({ name: "", category_id: category.id }));
  expectZodError(() => schema.parse({ name: "X", category_id: "" }));
});

void test("mcp: localfin_update_subcategory", async (t) => {
  await useTempDatabase(t);
  const category = createCategory({ name: "Food", type: "expense" });
  const sub = createSubcategory({ name: "Groceries", category_id: category.id });
  const updated = updateSubcategory(sub.id, { name: "Groceries Updated" });
  assert.equal(updated.name, "Groceries Updated");
});

void test("mcp: localfin_list_tags and create/update", async (t) => {
  await useTempDatabase(t);
  const schemaCreate = localfinCreateTagInputSchema;
  const parsed = schemaCreate.parse({ name: "Trip", type: "trip" });
  const tag = createTag(parsed);
  assert.equal(tag.name, "Trip");
  assert.equal(getTags().length, 1);
  const updated = updateTag(tag.id, { name: "Trip Updated" });
  assert.equal(updated.name, "Trip Updated");
  expectZodError(() => schemaCreate.parse({ name: "" }));
});

void test("mcp: localfin_search_transactions success and validation error", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  createTransaction({
    account_id: account.id,
    date: "2026-01-15",
    name: "Whole Foods",
    amount: -48.23,
    kind: "expense",
  });
  createTransaction({
    account_id: account.id,
    date: "2026-01-16",
    name: "Uber Trip",
    amount: -21.5,
    kind: "expense",
  });
  const schema = localfinSearchTransactionsInputSchema;
  // success: search with field syntax, quoted phrase, amount comparison
  const parsed = schema.parse({ searchQuery: 'name:"Whole Foods" amount>-50', limit: 10 });
  const results = getTransactionsWithDetails({
    searchQuery: parsed.searchQuery,
    limit: parsed.limit ?? 500,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.name, "Whole Foods");

  // complex grammar: parentheses, AND/OR, -term
  const complex = getTransactionsWithDetails({
    searchQuery: '(name:"Uber" OR name:"Whole") -"Eats"',
    limit: 10,
  });
  assert.ok(complex.length >= 1);

  // validation error: limit too large, strict unknown field
  expectZodError(() => schema.parse({ limit: 9999 }));
  expectZodError(() => schema.parse({ searchQuery: "hi", unknown: 1 } as never));
});

void test("mcp: localfin_create_transaction success and validation error", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const schema = localfinCreateTransactionInputSchema;
  const parsed = schema.parse({
    account_id: account.id,
    date: "2026-01-20",
    name: "Test Tx",
    amount: -10,
  });
  const tx = createTransaction(parsed);
  assert.equal(tx.name, "Test Tx");
  expectZodError(() => schema.parse({ account_id: "", date: "2026-01-20", name: "X", amount: 10 }));
  expectZodError(() => schema.parse({ account_id: account.id, date: "not-a-date", name: "X", amount: 10 }));
});

void test("mcp: localfin_bulk_create_transactions", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const result = bulkCreateTransactions([
    { account_id: account.id, date: "2026-01-20", name: "Bulk 1", amount: -5 },
    { account_id: account.id, date: "2026-01-21", name: "Bulk 2", amount: -15 },
  ]);
  assert.equal(result.length, 2);
  const schema = localfinBulkCreateTransactionsInputSchema;
  expectZodError(() => schema.parse({ transactions: [] }));
});

void test("mcp: localfin_update_transaction", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const tx = createTransaction({
    account_id: account.id,
    date: "2026-01-20",
    name: "Original",
    amount: -10,
  });
  const updated = updateTransaction(tx.id, { name: "Updated" });
  assert.equal(updated?.name, "Updated");
  const schema = localfinUpdateTransactionInputSchema;
  expectZodError(() => schema.parse({ id: "" }));
});

void test("mcp: localfin_bulk_update_transactions", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const tx1 = createTransaction({ account_id: account.id, date: "2026-01-20", name: "A", amount: -10 });
  const tx2 = createTransaction({ account_id: account.id, date: "2026-01-20", name: "B", amount: -20 });
  bulkUpdateTransactions([tx1.id, tx2.id], { kind: "expense" });
  const schema = localfinBulkUpdateTransactionsInputSchema;
  expectZodError(() => schema.parse({ ids: [], updates: { kind: "expense" } }));
  expectZodError(() => schema.parse({ ids: [tx1.id], updates: {} }));
});

void test("mcp: localfin_delete and restore transaction", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const tx = createTransaction({ account_id: account.id, date: "2026-01-20", name: "ToDelete", amount: -10 });
  deleteTransaction(tx.id);
  const afterDelete = getTransactionsWithDetails({});
  assert.equal(afterDelete.length, 0);
  const restored = restoreTransaction(tx.id);
  assert.equal(restored.name, "ToDelete");
  const schema = localfinDeleteTransactionInputSchema;
  expectZodError(() => schema.parse({ id: "" }));
});

void test("mcp: localfin_dashboard success and validation error", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  createTransaction({ account_id: account.id, date: "2026-01-10", name: "Income", amount: 1000, kind: "income" });
  const schema = localfinDashboardInputSchema;
  const parsed = schema.parse({ startDate: "2026-01-01", endDate: "2026-01-31" });
  const metrics = getDashboardMetrics(parsed.startDate, parsed.endDate);
  const accountSummary = getAccountSummary(parsed.startDate, parsed.endDate);
  const categorySummary = getCategorySummary(parsed.startDate, parsed.endDate);
  assert.ok(metrics);
  assert.ok(accountSummary);
  assert.ok(categorySummary);
  expectZodError(() => schema.parse({ startDate: "invalid", endDate: "2026-01-31" }));
  expectZodError(() => schema.parse({ startDate: "2026-01-01", endDate: "2026-01-31", unknown: 1 } as never));
});

void test("mcp: localfin_parse_statement success and validation error", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const schema = localfinParseStatementInputSchema;
  const parsed = schema.parse({
    text: "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n09/12/2026,09/13/2026,TRADER JOES,Food,Sale,-48.23,",
    accountId: account.id,
  });
  const result = parseStatement(parsed.text, parsed.accountId);
  assert.ok(result.transactions.length >= 1);
  expectZodError(() => schema.parse({ text: "", accountId: account.id }));
  expectZodError(() => schema.parse({ text: "hi", accountId: "" }));
});
