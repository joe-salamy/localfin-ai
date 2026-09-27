import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { getDb, closeDbForTests } from "./db/index.js";
import { ConflictError } from "./errors.js";
import { createAccount, deleteAccount, restoreAccount } from "./services/accounts.js";
import {
  createCategory,
  createSubcategory,
  deleteSubcategory,
} from "./services/categories.js";
import { prepareNetWorthData } from "./services/charts.js";
import { parseDate, parseStatement } from "./services/parser.js";
import {
  bulkRestoreTransactions,
  createTransaction,
  deleteTransaction,
  restoreTransaction,
} from "./services/transactions.js";
import { expectEnvelope, useApp, useTempDatabase } from "./tests/helpers.js";
import { buildTransactionPayloads } from "../scripts/ingest-statement-csv.js";

void test("seed leaves system rows untouched on restart", async (t) => {
  await useTempDatabase(t);
  const stamps = () =>
    getDb()
      .prepare(
        "SELECT id, updated_at FROM categories WHERE is_system = 1 UNION ALL SELECT id, updated_at FROM subcategories WHERE is_system = 1 ORDER BY 1",
      )
      .all();
  assert.equal(stamps().length, 4);
  getDb().prepare("UPDATE categories SET updated_at = 'pinned' WHERE is_system = 1").run();
  getDb().prepare("UPDATE subcategories SET updated_at = 'pinned' WHERE is_system = 1").run();
  closeDbForTests();
  assert.ok(stamps().every((row) => (row as { updated_at: string }).updated_at === "pinned"));
});

void test("parser dates: no-year rows never land in the future, invalid dates need review", async (t) => {
  const today = new Date(2026, 0, 15);
  assert.equal(parseDate("12/28", today), "2025-12-28");
  assert.equal(parseDate("01/10", today), "2026-01-10");
  assert.equal(parseDate("01/15", today), "2026-01-15");

  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const result = parseStatement(
    [
      '"Date","Transaction","Name","Memo","Amount"',
      '"2026-13-40","DEBIT","BAD DATE STORE","x","-5.00"',
    ].join("\n"),
    account.id,
  );
  assert.equal(result.transactions[0]?.needsReview, true);
});

void test("ingest reuses a past subcategory only for the same kind", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Card", type: "liability" });
  const refunds = createCategory({ name: "Refunds", type: "income" });
  const returns = createSubcategory({ name: "Returns", category_id: refunds.id });
  for (const date of ["2026-01-01", "2026-01-02", "2026-01-03"]) {
    createTransaction({ account_id: account.id, date, name: "SHOP", amount: 5, kind: "income", subcategory_id: returns.id });
  }
  const row = {
    name: "SHOP",
    date: "2026-02-01",
    originalLine: "",
    needsReview: false,
    isDuplicate: false,
  };
  const { payloads } = buildTransactionPayloads(
    [
      { ...row, amount: 20, kind: "expense" },
      { ...row, amount: -5, kind: "income" },
    ],
    account.id,
  );
  assert.equal(payloads[0]?.subcategory_id, null);
  assert.equal(payloads[1]?.subcategory_id, returns.id);
});

void test("subcategories with transactions cannot be deleted", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const food = createCategory({ name: "Food", type: "expense" });
  const groceries = createSubcategory({ name: "Groceries", category_id: food.id });
  const txn = createTransaction({ account_id: account.id, date: "2026-01-01", name: "Market", amount: -5, kind: "expense", subcategory_id: groceries.id });
  assert.throws(() => deleteSubcategory(groceries.id), /1 transaction/);
  deleteTransaction(txn.id);
  deleteSubcategory(groceries.id);
});

void test("restore: active rows conflict, bulk restore skips rows on deleted accounts", async (t) => {
  await useTempDatabase(t);
  const kept = createAccount({ name: "Kept", type: "asset" });
  const gone = createAccount({ name: "Gone", type: "asset" });
  const a = createTransaction({ account_id: kept.id, date: "2026-01-01", name: "A", amount: -1, kind: "expense" });
  const b = createTransaction({ account_id: gone.id, date: "2026-01-01", name: "B", amount: -1, kind: "expense" });
  assert.throws(() => restoreTransaction(a.id), ConflictError);
  assert.throws(() => restoreAccount(kept.id), ConflictError);

  deleteTransaction(a.id);
  deleteTransaction(b.id);
  deleteAccount(gone.id);
  assert.deepEqual(bulkRestoreTransactions([a.id, b.id]), [a.id]);
});

void test("net-worth chart keeps balances apart from point fields", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "date", type: "asset", initial_balance: 100 });
  createAccount({ name: "Card", type: "liability", initial_balance: 40 });
  createTransaction({ account_id: account.id, date: "2026-01-05", name: "Pay", amount: 50, kind: "income" });
  const chart = prepareNetWorthData("2026-01-01", "2026-01-10");
  // The range is clamped to the first transaction, so the first point is its day.
  const [first] = chart.points;
  const last = chart.points.at(-1);
  assert.equal(first?.date, "2026-01-05");
  assert.equal(last?.date, "2026-01-10");
  assert.deepEqual(last?.balances, { date: 150, Card: 40 });
  assert.equal(last?.netWorth, 110);
  assert.ok(chart.accountColors.date);
});

void test("dashboard routes reject filters they do not support", async (t) => {
  const baseUrl = await useApp(t, "localfin-dashboard-route-");
  const range = "startDate=2026-01-01&endDate=2026-01-31";
  const rejected = await fetch(`${baseUrl}/api/dashboard/charts/net-worth?${range}&tagIds=x`);
  assert.equal(rejected.status, 400);
  const accepted = await fetch(`${baseUrl}/api/dashboard/metrics?${range}&tagIds=x`);
  assert.equal((await expectEnvelope(accepted)).success, true);
});

void test("MCP server writes only JSON-RPC to stdout", async (t) => {
  const dbPath = await useTempDatabase(t);
  const child = spawn(process.execPath, ["--import", "tsx", "server/mcp/index.ts"], {
    env: { ...process.env, LOCALFIN_DB_PATH: dbPath },
    stdio: ["pipe", "pipe", "ignore"],
  });
  t.after(() => child.kill());
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`,
  );
  const firstLine = await new Promise<string>((resolve) => {
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.includes("\n")) resolve(buffer.slice(0, buffer.indexOf("\n")));
    });
  });
  assert.equal((JSON.parse(firstLine) as { id: number }).id, 1);
});
