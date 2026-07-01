import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { closeDbForTests, getDb } from "./db/index.js";
import {
  createAccount,
  deleteAccount,
  getAccountById,
  restoreAccount,
} from "./services/accounts.js";
import {
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  getCategoryById,
  getSubcategoryById,
  restoreCategory,
  restoreSubcategory,
} from "./services/categories.js";
import {
  bulkCreateTransactions,
  bulkDeleteTransactions,
  bulkRestoreTransactions,
  bulkUpdateTransactions,
  createTransaction,
  deleteTransaction,
  getTransactionById,
  getTransactionsWithDetails,
  restoreTransaction,
  updateTransaction,
} from "./services/transactions.js";
import { createTag, deleteTag, getTagById, restoreTag } from "./services/tags.js";
import { getTagSummary } from "./services/dashboard.js";
import {
  getSuspectTransactionFindings,
  runSuspectTransactionScan,
  updateSuspectTransactionFindingStatus,
} from "./services/suspect-transactions.js";
import { compileTransactionSearch } from "./services/transaction-search.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;

async function useTempDatabase(
  t: { after: (fn: () => void | Promise<void>) => void },
  prefix = "localfin-core-test-",
): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");

  t.after(async () => {
    closeDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.LOCALFIN_DB_PATH;
    } else {
      process.env.LOCALFIN_DB_PATH = originalDbPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  return process.env.LOCALFIN_DB_PATH;
}

function createSubcategoryFixture(): {
  assetAccountId: string;
  liabilityAccountId: string;
  subcategoryId: string;
} {
  const asset = createAccount({ name: "Checking", type: "asset" });
  const liability = createAccount({ name: "Credit Card", type: "liability" });
  const category = createCategory({ name: "Food", type: "expense" });
  const subcategory = createSubcategory({
    name: "Groceries",
    category_id: category.id,
  });

  return {
    assetAccountId: asset.id,
    liabilityAccountId: liability.id,
    subcategoryId: subcategory.id,
  };
}

function deletedAtFor(
  table: "accounts" | "categories" | "subcategories" | "tags",
  id: string,
): string | null {
  const row = getDb()
    .prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`)
    .get(id) as { deleted_at: string | null } | undefined;
  assert.ok(row, `expected ${table} row ${id} to exist`);
  return row.deleted_at;
}

test("tag migration preserves transaction_tags foreign key after transaction rebuild", async (t) => {
  const dbPath = await useTempDatabase(t, "localfin-tag-migration-test-");
  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL DEFAULT 'expense' CHECK(kind IN ('income', 'expense', 'transfer')),
      subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
  `);
  legacyDb.close();

  const database = getDb();
  const foreignKeys = database
    .prepare("PRAGMA foreign_key_list(transaction_tags)")
    .all() as Array<{ table: string }>;
  assert.ok(
    foreignKeys.some((foreignKey) => foreignKey.table === "transactions"),
    "transaction_tags should reference the migrated transactions table",
  );
  assert.equal(
    foreignKeys.some(
      (foreignKey) => foreignKey.table === "transactions_legacy_kind",
    ),
    false,
  );

  const account = createAccount({ name: "Checking", type: "asset" });
  const tag = createTag({ name: "Migration Tag" });
  const transaction = createTransaction({
    account_id: account.id,
    date: "2026-06-10",
    name: "Tagged After Migration",
    amount: 12,
    kind: "expense",
    tag_ids: [tag.id],
  });

  assert.deepEqual(
    transaction.tags.map((item) => item.id),
    [tag.id],
  );
});

test("create transaction normalizes signs by account type and kind", async (t) => {
  await useTempDatabase(t);
  const { assetAccountId, liabilityAccountId, subcategoryId } =
    createSubcategoryFixture();

  const assetExpense = createTransaction({
    account_id: assetAccountId,
    date: "2026-05-01",
    name: "Asset Expense",
    amount: 12.34,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  const assetIncome = createTransaction({
    account_id: assetAccountId,
    date: "2026-05-02",
    name: "Asset Income",
    amount: -8,
    kind: "income",
  });
  const liabilityExpense = createTransaction({
    account_id: liabilityAccountId,
    date: "2026-05-03",
    name: "Liability Expense",
    amount: -24,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  const liabilityIncome = createTransaction({
    account_id: liabilityAccountId,
    date: "2026-05-04",
    name: "Liability Income",
    amount: 7,
    kind: "income",
  });

  assert.equal(assetExpense.amount, -12.34);
  assert.equal(assetIncome.amount, 8);
  assert.equal(liabilityExpense.amount, 24);
  assert.equal(liabilityIncome.amount, -7);
});

test("transaction updates normalize signs by account type and kind", async (t) => {
  await useTempDatabase(t);
  const { assetAccountId, liabilityAccountId, subcategoryId } =
    createSubcategoryFixture();

  const liabilityExpense = createTransaction({
    account_id: liabilityAccountId,
    date: "2026-05-05",
    name: "Liability Expense Update",
    amount: -24,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  const liabilityAmountUpdate = updateTransaction(liabilityExpense.id, {
    amount: -31,
  });
  const liabilityKindUpdate = updateTransaction(liabilityExpense.id, {
    kind: "income",
  });

  const assetIncome = createTransaction({
    account_id: assetAccountId,
    date: "2026-05-06",
    name: "Asset Income Update",
    amount: -8,
    kind: "income",
  });
  const assetKindUpdate = updateTransaction(assetIncome.id, {
    kind: "expense",
  });

  const bulkTarget = createTransaction({
    account_id: liabilityAccountId,
    date: "2026-05-07",
    name: "Bulk Liability Kind Update",
    amount: -45,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  bulkUpdateTransactions([bulkTarget.id], { kind: "income" });
  const bulkUpdated = getTransactionById(bulkTarget.id);

  assert.equal(liabilityAmountUpdate?.amount, 31);
  assert.equal(liabilityKindUpdate?.amount, -31);
  assert.equal(assetKindUpdate?.amount, -8);
  assert.equal(bulkUpdated?.amount, -45);
});

test("transfer and adjustment transactions remain uncategorized", async (t) => {
  await useTempDatabase(t);
  const { assetAccountId, subcategoryId } = createSubcategoryFixture();

  const transfer = createTransaction({
    account_id: assetAccountId,
    date: "2026-05-05",
    name: "Card Payment",
    amount: -100,
    kind: "transfer",
    subcategory_id: subcategoryId,
  });
  const adjustment = createTransaction({
    account_id: assetAccountId,
    date: "2026-05-06",
    name: "Balance Correction",
    amount: -15,
    kind: "adjustment",
    subcategory_id: subcategoryId,
  });

  assert.equal(transfer.amount, -100);
  assert.equal(transfer.subcategory_id, null);
  assert.equal(adjustment.amount, 15);
  assert.equal(adjustment.subcategory_id, null);
});

test("updating a categorized transaction to transfer or adjustment clears its subcategory", async (t) => {
  await useTempDatabase(t);
  const { assetAccountId, subcategoryId } = createSubcategoryFixture();
  const transferTarget = createTransaction({
    account_id: assetAccountId,
    date: "2026-05-07",
    name: "Transfer Target",
    amount: 50,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  const adjustmentTarget = createTransaction({
    account_id: assetAccountId,
    date: "2026-05-08",
    name: "Adjustment Target",
    amount: 25,
    kind: "expense",
    subcategory_id: subcategoryId,
  });

  updateTransaction(transferTarget.id, { kind: "transfer" });
  updateTransaction(adjustmentTarget.id, { kind: "adjustment" });

  const transfer = getTransactionsWithDetails({
    searchQuery: 'name:"Transfer Target"',
  })[0];
  const adjustment = getTransactionsWithDetails({
    searchQuery: 'name:"Adjustment Target"',
  })[0];

  assert.equal(transfer?.kind, "transfer");
  assert.equal(transfer?.subcategory_id, null);
  assert.equal(adjustment?.kind, "adjustment");
  assert.equal(adjustment?.subcategory_id, null);
});

test("transaction search treats SQL and LIKE metacharacters as literal parameters", async (t) => {
  await useTempDatabase(t);
  const { assetAccountId } = createSubcategoryFixture();
  const percentTag = createTag({ name: "100%", type: "custom" });
  createTransaction({
    account_id: assetAccountId,
    date: "2026-05-09",
    name: "100% Legit",
    amount: 10,
    kind: "income",
    tag_ids: [percentTag.id],
  });
  createTransaction({
    account_id: assetAccountId,
    date: "2026-05-10",
    name: "1000 Legit",
    amount: 10,
    kind: "income",
  });
  const compiled = compileTransactionSearch('name:"%_x\' OR 1=1 --"', {
    transaction: "t",
  });
  assert.equal(
    compiled.clause,
    "LOWER(COALESCE(t.name, '')) LIKE ? ESCAPE '\\'",
  );
  assert.deepEqual(compiled.params, ["%\\%\\_x' or 1=1 --%"]);

  const matches = getTransactionsWithDetails({ searchQuery: 'name:"100%"' });
  assert.deepEqual(
    matches.map((transaction) => transaction.name),
    ["100% Legit"],
  );

  const tagMatches = getTransactionsWithDetails({ searchQuery: 'tag:"100%"' });
  assert.deepEqual(
    tagMatches.map((transaction) => transaction.name),
    ["100% Legit"],
  );
});

test("transaction tags create, read, replace, filter, search, and delete cleanly", async (t) => {
  await useTempDatabase(t);
  const { assetAccountId, subcategoryId } = createSubcategoryFixture();
  const cabo = createTag({ name: "Cabo Trip", type: "trip" });
  const reimbursable = createTag({
    name: "Reimbursable",
    type: "reimbursable",
  });

  const tagged = createTransaction({
    account_id: assetAccountId,
    date: "2026-06-01",
    name: "Cabo Hotel",
    amount: 1000,
    kind: "expense",
    subcategory_id: subcategoryId,
    tag_ids: [cabo.id, reimbursable.id],
  });
  createTransaction({
    account_id: assetAccountId,
    date: "2026-06-02",
    name: "Local Hotel",
    amount: 200,
    kind: "expense",
    subcategory_id: subcategoryId,
  });

  const filtered = getTransactionsWithDetails({ tagIds: [cabo.id] });
  assert.deepEqual(
    filtered.map((transaction) => transaction.id),
    [tagged.id],
  );
  assert.deepEqual(
    filtered[0]?.tags.map((tag) => tag.name),
    ["Cabo Trip", "Reimbursable"],
  );

  const searchMatches = getTransactionsWithDetails({
    searchQuery: 'tag:"Cabo Trip"',
  });
  assert.deepEqual(
    searchMatches.map((transaction) => transaction.id),
    [tagged.id],
  );

  const updated = updateTransaction(tagged.id, { tag_ids: [reimbursable.id] });
  assert.deepEqual(
    updated?.tags.map((tag) => tag.name),
    ["Reimbursable"],
  );
  assert.equal(getTransactionsWithDetails({ tagIds: [cabo.id] }).length, 0);

  deleteTag(reimbursable.id);
  assert.deepEqual(getTransactionById(tagged.id)?.tags, []);
});

test("bulk tag edits add and remove without replacing unrelated tags", async (t) => {
  await useTempDatabase(t);
  const { assetAccountId, subcategoryId } = createSubcategoryFixture();
  const cabo = createTag({ name: "Cabo Trip", type: "trip" });
  const old = createTag({ name: "Old Project" });
  const keep = createTag({ name: "Keep Me" });
  const other = createTag({ name: "Other Tag" });
  const first = createTransaction({
    account_id: assetAccountId,
    date: "2026-06-03",
    name: "Tagged One",
    amount: 50,
    kind: "expense",
    subcategory_id: subcategoryId,
    tag_ids: [old.id, keep.id],
  });
  const second = createTransaction({
    account_id: assetAccountId,
    date: "2026-06-04",
    name: "Tagged Two",
    amount: 75,
    kind: "expense",
    subcategory_id: subcategoryId,
    tag_ids: [other.id],
  });

  bulkUpdateTransactions([first.id, second.id], {
    add_tag_ids: [cabo.id],
    remove_tag_ids: [old.id],
  });

  const firstTags = getTransactionById(first.id)
    ?.tags.map((tag) => tag.name)
    .sort();
  const secondTags = getTransactionById(second.id)
    ?.tags.map((tag) => tag.name)
    .sort();
  assert.deepEqual(firstTags, ["Cabo Trip", "Keep Me"]);
  assert.deepEqual(secondTags, ["Cabo Trip", "Other Tag"]);
});

test("tag summary reports spend, income, net, and category breakdown", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const expenseCategory = createCategory({ name: "Travel", type: "expense" });
  const expenseSubcategory = createSubcategory({
    name: "Hotels",
    category_id: expenseCategory.id,
  });
  const incomeCategory = createCategory({ name: "Work", type: "income" });
  const incomeSubcategory = createSubcategory({
    name: "Reimbursements",
    category_id: incomeCategory.id,
  });
  const trip = createTag({ name: "Cabo Trip", type: "trip" });

  createTransaction({
    account_id: account.id,
    date: "2026-06-05",
    name: "Cabo Hotel",
    amount: 100,
    kind: "expense",
    subcategory_id: expenseSubcategory.id,
    tag_ids: [trip.id],
  });
  createTransaction({
    account_id: account.id,
    date: "2026-06-06",
    name: "Cabo Reimbursement",
    amount: 250,
    kind: "income",
    subcategory_id: incomeSubcategory.id,
    tag_ids: [trip.id],
  });
  createTransaction({
    account_id: account.id,
    date: "2026-06-07",
    name: "Untagged Control",
    amount: 40,
    kind: "expense",
    subcategory_id: expenseSubcategory.id,
  });

  const summary = getTagSummary("2026-06-01", "2026-06-30");
  const tripSummary = summary.find((tag) => tag.tag_id === trip.id);
  assert.ok(tripSummary);
  assert.equal(tripSummary.expense_total, 100);
  assert.equal(tripSummary.income_total, 250);
  assert.equal(tripSummary.net_total, 150);
  assert.equal(tripSummary.transaction_count, 2);

  const expenseBreakdown = tripSummary.categories.find(
    (category) => category.category_id === expenseCategory.id,
  );
  const incomeBreakdown = tripSummary.categories.find(
    (category) => category.category_id === incomeCategory.id,
  );
  assert.equal(expenseBreakdown?.expense_total, 100);
  assert.equal(expenseBreakdown?.income_total, 0);
  assert.equal(incomeBreakdown?.expense_total, 0);
  assert.equal(incomeBreakdown?.income_total, 250);

  const filteredSummary = getTagSummary("2026-06-01", "2026-06-30", [trip.id]);
  assert.deepEqual(
    filteredSummary.map((tag) => tag.tag_id),
    [trip.id],
  );
});

test("database migration allows adjustment kind and absorbs legacy initial balance transactions", async (t) => {
  const dbPath = await useTempDatabase(t, "localfin-migration-test-");
  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      monthly_goal REAL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL DEFAULT 'expense' CHECK(kind IN ('income', 'expense', 'transfer')),
      subcategory_id TEXT,
      comment TEXT,
      is_initial_balance INTEGER NOT NULL DEFAULT 0,
      ai_suggested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE spending_goals (
      id TEXT PRIMARY KEY,
      subcategory_id TEXT NOT NULL,
      amount REAL NOT NULL,
      period TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE agent_conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      current_page TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT,
      actions_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    INSERT INTO accounts (id, name, type, created_at, updated_at)
    VALUES ('legacy-account', 'Legacy Checking', 'asset', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO transactions (
      id, account_id, date, name, amount, kind, is_initial_balance, created_at, updated_at
    )
    VALUES (
      'legacy-initial', 'legacy-account', '2026-01-01', 'Initial Balance', 125, 'income', 1,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `);
  legacyDb.close();

  const migratedDb = getDb();
  migratedDb
    .prepare(
      `INSERT INTO transactions (
        id, account_id, date, name, amount, kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-adjustment",
      "legacy-account",
      "2026-01-02",
      "Adjustment",
      5,
      "adjustment",
      "2026-01-02T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    );

  const account = migratedDb
    .prepare("SELECT initial_balance FROM accounts WHERE id = ?")
    .get("legacy-account") as { initial_balance: number };
  const initialBalanceRows = migratedDb
    .prepare("SELECT COUNT(*) AS count FROM transactions WHERE id = ?")
    .get("legacy-initial") as { count: number };

  assert.equal(account.initial_balance, 125);
  assert.equal(initialBalanceRows.count, 0);
});

test("suspect transaction scan persists explainable duplicate, flagged, and missing category findings", async (t) => {
  await useTempDatabase(t, "localfin-suspect-scan-test-");
  const { assetAccountId, subcategoryId } = createSubcategoryFixture();

  createTransaction({
    account_id: assetAccountId,
    date: "2026-05-11",
    name: "Coffee Shop",
    amount: 4.5,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  createTransaction({
    account_id: assetAccountId,
    date: "2026-05-11",
    name: "Coffee Shop",
    amount: 4.5,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  createTransaction({
    account_id: assetAccountId,
    date: "2026-05-12",
    name: "Bank Fee",
    amount: 12,
    kind: "expense",
  });

  const result = runSuspectTransactionScan({ flaggedWords: ["fee"] });

  assert.equal(result.run.total_scanned, 3);
  assert.equal(result.findings.length, 3);
  assert.ok(
    result.findings.some((finding) =>
      finding.reason_codes.includes("exact_duplicate"),
    ),
  );
  assert.ok(
    result.findings.some((finding) =>
      finding.reason_codes.includes("flagged_word"),
    ),
  );
  assert.ok(
    result.findings.some((finding) =>
      finding.reason_codes.includes("missing_category"),
    ),
  );

  const openFindings = getSuspectTransactionFindings({ status: "open" });
  assert.equal(openFindings.length, 3);
  assert.ok(openFindings.every((finding) => finding.transaction));
});

test("suspect transaction scan detects robust amount outliers and ignores soft-deleted transactions", async (t) => {
  await useTempDatabase(t, "localfin-suspect-outlier-test-");
  const { assetAccountId, subcategoryId } = createSubcategoryFixture();

  for (let day = 1; day <= 6; day += 1) {
    createTransaction({
      account_id: assetAccountId,
      date: `2026-04-0${day}`,
      name: "Grocer",
      amount: 20 + day,
      kind: "expense",
      subcategory_id: subcategoryId,
    });
  }
  const outlier = createTransaction({
    account_id: assetAccountId,
    date: "2026-04-10",
    name: "Grocer",
    amount: 500,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  const deleted = createTransaction({
    account_id: assetAccountId,
    date: "2026-04-11",
    name: "Deleted Fee",
    amount: 999,
    kind: "expense",
    subcategory_id: subcategoryId,
  });
  getDb()
    .prepare("UPDATE transactions SET deleted_at = ? WHERE id = ?")
    .run("2026-04-12T00:00:00.000Z", deleted.id);

  const result = runSuspectTransactionScan({ flaggedWords: ["fee"] });
  const outlierFinding = result.findings.find(
    (finding) => finding.transaction_id === outlier.id,
  );

  assert.ok(outlierFinding);
  assert.ok(outlierFinding.reason_codes.includes("large_amount_outlier"));
  assert.ok(outlierFinding.reason_codes.includes("merchant_amount_outlier"));
  assert.ok(
    result.findings.every((finding) => finding.transaction_id !== deleted.id),
  );
});

test("suspect finding status updates persist", async (t) => {
  await useTempDatabase(t, "localfin-suspect-status-test-");
  const { assetAccountId } = createSubcategoryFixture();
  createTransaction({
    account_id: assetAccountId,
    date: "2026-05-13",
    name: "ATM Fee",
    amount: 3,
    kind: "expense",
  });

  const result = runSuspectTransactionScan({ flaggedWords: ["fee"] });
  const finding = result.findings[0];
  assert.ok(finding);

  const updated = updateSuspectTransactionFindingStatus(
    finding.id,
    "dismissed",
  );
  assert.equal(updated?.status, "dismissed");
  assert.equal(getSuspectTransactionFindings({ status: "open" }).length, 0);
  assert.equal(
    getSuspectTransactionFindings({ status: "dismissed" }).length,
    1,
  );
});

test("suspect scan carries dismissed findings forward on later scans", async (t) => {
  await useTempDatabase(t, "localfin-suspect-status-rerun-test-");
  const { assetAccountId } = createSubcategoryFixture();
  createTransaction({
    account_id: assetAccountId,
    date: "2026-05-14",
    name: "Monthly Fee",
    amount: 8,
    kind: "expense",
  });

  const firstRun = runSuspectTransactionScan({ flaggedWords: ["fee"] });
  const finding = firstRun.findings.find((item) =>
    item.reason_codes.includes("flagged_word"),
  );
  assert.ok(finding);

  updateSuspectTransactionFindingStatus(finding.id, "dismissed");
  const secondRun = runSuspectTransactionScan({ flaggedWords: ["fee"] });
  const repeatedFinding = secondRun.findings.find(
    (item) => item.transaction_id === finding.transaction_id,
  );

  assert.equal(repeatedFinding?.status, "dismissed");
  assert.equal(getSuspectTransactionFindings({ status: "open" }).length, 0);
});

test("transaction restore preserves ids, tag associations, and bulk request order", async (t) => {
  await useTempDatabase(t, "localfin-transaction-restore-test-");
  const { assetAccountId, subcategoryId } = createSubcategoryFixture();
  const project = createTag({ name: "Restore Project" });
  const tagged = createTransaction({
    account_id: assetAccountId,
    date: "2026-06-10",
    name: "Tagged Transaction",
    amount: 42,
    kind: "expense",
    subcategory_id: subcategoryId,
    tag_ids: [project.id],
  });

  deleteTransaction(tagged.id);
  assert.equal(getTransactionById(tagged.id), null);

  const restored = restoreTransaction(tagged.id);
  assert.equal(restored.id, tagged.id);
  assert.deepEqual(
    restored.tags.map((tag) => tag.id),
    [project.id],
  );

  const bulkCreated = bulkCreateTransactions([
    {
      account_id: assetAccountId,
      date: "2026-06-11",
      name: "Bulk Restore First",
      amount: 12,
      kind: "expense",
      subcategory_id: subcategoryId,
      tag_ids: [project.id],
    },
    {
      account_id: assetAccountId,
      date: "2026-06-12",
      name: "Bulk Restore Second",
      amount: 34,
      kind: "expense",
      subcategory_id: subcategoryId,
    },
  ]);
  const first = bulkCreated.find(
    (transaction) => transaction.name === "Bulk Restore First",
  );
  const second = bulkCreated.find(
    (transaction) => transaction.name === "Bulk Restore Second",
  );
  assert.ok(first);
  assert.ok(second);

  bulkDeleteTransactions([first.id, second.id]);
  assert.equal(getTransactionById(first.id), null);
  assert.equal(getTransactionById(second.id), null);

  const requestedOrder = [second.id, first.id];
  const restoredBulk = bulkRestoreTransactions(requestedOrder);

  assert.deepEqual(
    restoredBulk.map((transaction) => transaction.id),
    requestedOrder,
  );
  assert.deepEqual(
    getTransactionById(first.id)?.tags.map((tag) => tag.id),
    [project.id],
  );
});

test("entity restores preserve ids and retained tag associations", async (t) => {
  await useTempDatabase(t, "localfin-entity-restore-test-");

  const account = createAccount({ name: "Restorable Account", type: "asset" });
  deleteAccount(account.id);
  assert.equal(getAccountById(account.id), undefined);
  const restoredAccount = restoreAccount(account.id);
  assert.equal(restoredAccount.id, account.id);

  const category = createCategory({
    name: "Restorable Category",
    type: "expense",
  });
  deleteCategory(category.id);
  assert.equal(getCategoryById(category.id), undefined);
  const restoredCategory = restoreCategory(category.id);
  assert.equal(restoredCategory.id, category.id);

  const parentCategory = createCategory({
    name: "Restorable Parent Category",
    type: "expense",
  });
  const subcategory = createSubcategory({
    name: "Restorable Subcategory",
    category_id: parentCategory.id,
  });
  deleteSubcategory(subcategory.id);
  assert.equal(getSubcategoryById(subcategory.id), undefined);
  const restoredSubcategory = restoreSubcategory(subcategory.id);
  assert.equal(restoredSubcategory.id, subcategory.id);
  assert.equal(restoredSubcategory.category_id, parentCategory.id);

  const tag = createTag({ name: "Restorable Tag" });
  const tagged = createTransaction({
    account_id: restoredAccount.id,
    date: "2026-06-13",
    name: "Tagged Before Tag Delete",
    amount: 19,
    kind: "expense",
    subcategory_id: restoredSubcategory.id,
    tag_ids: [tag.id],
  });

  deleteTag(tag.id);
  assert.equal(getTagById(tag.id), undefined);
  assert.deepEqual(getTransactionById(tagged.id)?.tags, []);

  const restoredTag = restoreTag(tag.id);
  assert.equal(restoredTag.id, tag.id);
  assert.deepEqual(
    getTransactionById(tagged.id)?.tags.map((transactionTag) => transactionTag.id),
    [tag.id],
  );
});

test("same-key restore conflicts leave deleted rows deleted", async (t) => {
  await useTempDatabase(t, "localfin-restore-conflict-test-");

  const deletedAccount = createAccount({
    name: "Conflict Restore Account",
    type: "asset",
  });
  deleteAccount(deletedAccount.id);
  createAccount({ name: deletedAccount.name, type: "liability" });
  assert.throws(
    () => restoreAccount(deletedAccount.id),
    /An account with the name "Conflict Restore Account" already exists/,
  );
  assert.equal(getAccountById(deletedAccount.id), undefined);
  assert.ok(deletedAtFor("accounts", deletedAccount.id));

  const deletedCategory = createCategory({
    name: "Conflict Restore Category",
    type: "expense",
  });
  deleteCategory(deletedCategory.id);
  createCategory({ name: deletedCategory.name, type: "expense" });
  assert.throws(
    () => restoreCategory(deletedCategory.id),
    /A category with the name "Conflict Restore Category" and type "expense" already exists/,
  );
  assert.equal(getCategoryById(deletedCategory.id), undefined);
  assert.ok(deletedAtFor("categories", deletedCategory.id));

  const parentCategory = createCategory({
    name: "Conflict Restore Parent",
    type: "expense",
  });
  const deletedSubcategory = createSubcategory({
    name: "Conflict Restore Subcategory",
    category_id: parentCategory.id,
  });
  deleteSubcategory(deletedSubcategory.id);
  createSubcategory({
    name: deletedSubcategory.name,
    category_id: parentCategory.id,
  });
  assert.throws(
    () => restoreSubcategory(deletedSubcategory.id),
    /A subcategory with the name "Conflict Restore Subcategory" already exists/,
  );
  assert.equal(getSubcategoryById(deletedSubcategory.id), undefined);
  assert.ok(deletedAtFor("subcategories", deletedSubcategory.id));

  const deletedTag = createTag({ name: "Conflict Restore Tag", type: "trip" });
  deleteTag(deletedTag.id);
  createTag({ name: deletedTag.name, type: deletedTag.type });
  assert.throws(
    () => restoreTag(deletedTag.id),
    /A tag with the name "Conflict Restore Tag" and type "trip" already exists/,
  );
  assert.equal(getTagById(deletedTag.id), undefined);
  assert.ok(deletedAtFor("tags", deletedTag.id));
});
