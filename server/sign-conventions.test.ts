import assert from "node:assert/strict";
import test from "node:test";
import { createAccount } from "./services/accounts.js";
import { createCategory, createSubcategory } from "./services/categories.js";
import {
  getCategorySummary,
  getDashboardMetrics,
  getTagSummary,
} from "./services/dashboard.js";
import { prepareSankeyData } from "./services/charts.js";
import { parseStatement } from "./services/parser.js";
import { runSuspectTransactionScan } from "./services/suspect-transactions.js";
import { createTag } from "./services/tags.js";
import {
  checkTransferMatch,
  createTransaction,
  getTransactionsWithDetails,
} from "./services/transactions.js";
import { useTempDatabase } from "./tests/helpers.js";

// Checking (asset) stores expenses negative; the card (liability) stores
// purchases positive and refunds negative. Totals must not cancel out.
function mixedAccountFixture() {
  const checking = createAccount({ name: "Checking", type: "asset" });
  const card = createAccount({ name: "Card", type: "liability" });
  const food = createCategory({ name: "Food", type: "expense" });
  const groceries = createSubcategory({ name: "Groceries", category_id: food.id });
  const refunds = createCategory({ name: "Refunds", type: "income" });
  const returns = createSubcategory({ name: "Returns", category_id: refunds.id });
  const tag = createTag({ name: "trip" });
  const base = { date: "2026-03-10", tag_ids: [tag.id] };
  createTransaction({ ...base, account_id: checking.id, name: "Market", amount: 30, kind: "expense", subcategory_id: groceries.id });
  createTransaction({ ...base, account_id: card.id, name: "Grocer", amount: 70, kind: "expense", subcategory_id: groceries.id });
  createTransaction({ ...base, account_id: card.id, name: "Return", amount: 10, kind: "income", subcategory_id: returns.id });
  return { checking, card, tag };
}

void test("dashboard aggregates use net-worth effect across account types", async (t) => {
  await useTempDatabase(t);
  const { tag } = mixedAccountFixture();

  const metrics = getDashboardMetrics("2026-03-01", "2026-03-31");
  assert.equal(metrics.totalExpenses, 100);
  assert.equal(metrics.totalIncome, 10);
  assert.equal(metrics.netChange, -90);

  const categories = getCategorySummary("2026-03-01", "2026-03-31");
  const food = categories.find((c) => c.category_name === "Food");
  const refunds = categories.find((c) => c.category_name === "Refunds");
  assert.equal(food?.total, -100);
  assert.equal(refunds?.total, 10);

  const sankey = prepareSankeyData("2026-03-01", "2026-03-31");
  const toExpenses = sankey.links.find((l) => l.source === "Total Income" && l.target === "Total Expenses");
  assert.equal(toExpenses?.value, 10);
  const groceries = sankey.links.find((l) => l.target === "Groceries (expense)");
  assert.equal(groceries?.value, 100);

  const [summary] = getTagSummary("2026-03-01", "2026-03-31", [tag.id]);
  assert.equal(summary.expense_total, 100);
  assert.equal(summary.income_total, 10);
  assert.equal(summary.net_total, -90);
});

void test("card payments match their checking-side transfer", async (t) => {
  await useTempDatabase(t);
  const checking = createAccount({ name: "Checking", type: "asset" });
  const card = createAccount({ name: "Card", type: "liability" });
  const savings = createAccount({ name: "Savings", type: "asset" });
  const fromChecking = createTransaction({ account_id: checking.id, date: "2026-03-01", name: "PAYMENT TO CARD", amount: -500, kind: "transfer" });
  const onCard = createTransaction({ account_id: card.id, date: "2026-03-02", name: "PAYMENT THANK YOU", amount: -500, kind: "transfer" });
  createTransaction({ account_id: savings.id, date: "2026-03-05", name: "TRANSFER FROM CHECKING", amount: 200, kind: "transfer" });
  createTransaction({ account_id: checking.id, date: "2026-03-05", name: "TRANSFER TO SAVINGS", amount: -200, kind: "transfer" });

  assert.equal(checkTransferMatch(-500, checking.id, "2026-03-01")?.id, onCard.id);
  assert.equal(checkTransferMatch(-500, card.id, "2026-03-02")?.id, fromChecking.id);
  assert.equal(checkTransferMatch(-200, checking.id, "2026-03-05")?.account_id, savings.id);

  const scan = runSuspectTransactionScan({});
  const unmatched = scan.findings.filter((f) => f.reason_codes.includes("unmatched_transfer_like"));
  assert.deepEqual(unmatched, []);
});

void test("search type and amount fields ignore stored sign conventions", async (t) => {
  await useTempDatabase(t);
  mixedAccountFixture();
  const names = (searchQuery: string) =>
    getTransactionsWithDetails({ searchQuery }).map((row) => row.name).sort();

  assert.deepEqual(names("type:income"), ["Return"]);
  assert.deepEqual(names("type:expense"), ["Grocer", "Market"]);
  assert.deepEqual(names("amount>20"), ["Grocer", "Market"]);
  assert.deepEqual(names("amount:30"), ["Market"]);
});

void test("parser keeps transfer direction on asset and liability accounts", async (t) => {
  await useTempDatabase(t);
  const checking = createAccount({ name: "Checking", type: "asset" });
  const usbank = await parseStatement(
    [
      '"Date","Transaction","Name","Memo","Amount"',
      '"2026-07-13","CREDIT","ONLINE TRANSFER FROM SAVINGS","x","250.00"',
      '"2026-07-14","DEBIT","ONLINE TRANSFER TO SAVINGS","x","-100.00"',
    ].join("\n"),
    checking.id,
  );
  assert.deepEqual(usbank.transactions.map((row) => [row.kind, row.amount]), [
    ["transfer", 250],
    ["transfer", -100],
  ]);

  const card = createAccount({ name: "Discover", type: "liability" });
  const discover = await parseStatement(
    [
      "Trans. Date,Post Date,Description,Amount,Category",
      '09/07/2026,09/08/2026,"INTERNET PAYMENT - THANK YOU",-500.00,"Payments and Credits"',
    ].join("\n"),
    card.id,
  );
  assert.equal(discover.transactions[0]?.amount, -500);
});
