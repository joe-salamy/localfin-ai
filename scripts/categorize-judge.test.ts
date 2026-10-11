import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createAccount } from "../server/services/accounts.js";
import { createCategory, createSubcategory } from "../server/services/categories.js";
import { createTransaction } from "../server/services/transactions/create.js";
import { getTransactionById } from "../server/services/transactions/read.js";
import { updateTransaction } from "../server/services/transactions/update.js";
import { useTempDatabase } from "../server/tests/helpers.js";
import { applyJudgments, buildJudgeInput, decideJudgment, type JudgeState } from "./categorize-judge.js";
import { mapInboxFiles } from "./ingest-inbox.js";

const answer = (choice: string, confidence: number) => ({ choice, confidence });

void test("judge input covers uncategorized income/expense rows with history examples and no system labels", async (t) => {
  await useTempDatabase(t, "localfin-judge-input-");
  const card = createAccount({ name: "Card", type: "liability" });
  const other = createAccount({ name: "Other", type: "liability" });
  const food = createCategory({ name: "Food", type: "expense" });
  const groceries = createSubcategory({ name: "Groceries", category_id: food.id });
  createTransaction({ account_id: other.id, date: "2026-01-01", name: "TRADER JOE S #019 SAN FRANCISCO", amount: 9, kind: "expense", subcategory_id: groceries.id });
  const pending = createTransaction({ account_id: card.id, date: "2026-02-01", name: "TRADER JOE S #215", amount: 12, kind: "expense" });
  createTransaction({ account_id: card.id, date: "2026-02-02", name: "Payment Thank You", amount: -50, kind: "transfer" });

  const input = buildJudgeInput();
  assert.deepEqual(Object.keys(input.states), [pending.id]);
  assert.deepEqual(input.labels, { "Food > Groceries": { id: groceries.id, type: "expense" } });
  assert.deepEqual(input.states[pending.id]?.examples, [
    { name: "TRADER JOE S #019 SAN FRANCISCO", subcategory: "Food > Groceries" },
  ]);
});

void test("decideJudgment: threshold is inclusive, kind/label type must agree, payment-like names fall back to transfer", () => {
  const labels = {
    "Food > Groceries": { id: "g", type: "expense" as const },
    "Income > Refunds": { id: "r", type: "income" as const },
  };
  const state: JudgeState = {
    name: "SHOP",
    amount: 10,
    date: "2026-01-01",
    account_name: "Card",
    account_type: "liability",
    parser_kind: "expense",
    paymentish_name_match: false,
    examples: [],
  };
  const decide = (kind: [string, number], sub: [string, number], s = state) =>
    decideJudgment(s, { txn_kind: answer(...kind), subcategory: answer(...sub) }, labels, 0.6);

  assert.equal(decide(["expense", 0.9], ["Food > Groceries", 0.6]).action, "categorize");
  assert.equal(decide(["expense", 0.9], ["Food > Groceries", 0.59]).action, "review");
  assert.equal(decide(["expense", 0.9], ["Income > Refunds", 0.95]).action, "review");
  // Low-confidence kind keeps the parser kind; a confident one switches it.
  assert.equal(decide(["income", 0.5], ["Income > Refunds", 0.95]).action, "review");
  assert.deepEqual(decide(["income", 0.7], ["Income > Refunds", 0.95]), {
    action: "categorize",
    kind: "income",
    subcategoryId: "r",
    label: "Income > Refunds",
    confidence: 0.95,
  });
  assert.equal(decide(["transfer", 0.6], ["Food > Groceries", 0.99]).action, "transfer");
  const paymentish = { ...state, paymentish_name_match: true };
  assert.equal(decide(["expense", 0.9], ["Uncertain", 0.9], paymentish).action, "transfer");
  assert.equal(decide(["expense", 0.9], ["Food > Groceries", 0.9], paymentish).action, "categorize");
  assert.equal(decideJudgment(state, undefined, labels, 0.6).action, "review");
});

void test("applyJudgments writes model choices with ai_suggested, skips stale rows, exports only review rows", async (t) => {
  const dbPath = await useTempDatabase(t, "localfin-judge-apply-");
  const card = createAccount({ name: "Card", type: "liability" });
  const food = createCategory({ name: "Food", type: "expense" });
  const groceries = createSubcategory({ name: "Groceries", category_id: food.id });
  const accepted = createTransaction({ account_id: card.id, date: "2026-02-01", name: "KROGER", amount: 12, kind: "expense" });
  const unsure = createTransaction({ account_id: card.id, date: "2026-02-01", name: "MYSTERY", amount: 7, kind: "expense" });
  const autopay = createTransaction({ account_id: card.id, date: "2026-02-01", name: "AUTOPAY THANKS", amount: -40, kind: "income" });
  const stale = createTransaction({ account_id: card.id, date: "2026-02-01", name: "STALE", amount: 3, kind: "expense" });
  const input = buildJudgeInput();
  updateTransaction(stale.id, { subcategory_id: groceries.id });

  const directory = path.dirname(dbPath);
  const out = path.join(directory, "review.fods");
  const result = await applyJudgments({
    input,
    results: {
      [accepted.id]: { txn_kind: answer("expense", 0.9), subcategory: answer("Food > Groceries", 0.8) },
      [unsure.id]: { txn_kind: answer("expense", 0.9), subcategory: answer("Food > Groceries", 0.4) },
      [autopay.id]: { txn_kind: answer("income", 0.7), subcategory: answer("Uncertain", 0.9) },
      [stale.id]: { txn_kind: answer("expense", 0.9), subcategory: answer("Food > Groceries", 0.9) },
    },
    threshold: 0.6,
    dryRun: false,
    out,
    logDirectory: path.join(directory, "logs"),
  });

  assert.deepEqual(
    { categorized: result.categorized, transfers: result.transfers, review: result.review, stale: result.stale },
    { categorized: 1, transfers: 1, review: [unsure.id], stale: 1 },
  );
  const acceptedRow = getTransactionById(accepted.id);
  assert.equal(acceptedRow?.subcategory_id, groceries.id);
  assert.equal(acceptedRow?.ai_suggested, true);
  const autopayRow = getTransactionById(autopay.id);
  assert.equal(autopayRow?.kind, "transfer");
  assert.equal(autopayRow?.subcategory_id, null);
  assert.equal(autopayRow?.amount, -40);
  assert.equal(getTransactionById(unsure.id)?.subcategory_id, null);
  assert.equal(getTransactionById(stale.id)?.ai_suggested, false);
  assert.equal(result.reviewPath, out);
  assert.ok(existsSync(out));
});

void test("inbox mapping requires exactly one rule per staged CSV", () => {
  const rules = [
    { pattern: /^Chase4466_/i, account: "Chase" },
    { pattern: /^Checking - 0726_/i, account: "Checking" },
    { pattern: /checking/i, account: "Overlap" },
  ];
  const { mapped, errors } = mapInboxFiles(
    ["Chase4466_Activity_20261009.csv", "Checking - 0726_07-09-2026.csv", "Unknown.csv"],
    rules,
  );
  assert.deepEqual(mapped, [{ fileName: "Chase4466_Activity_20261009.csv", account: "Chase" }]);
  assert.equal(errors.length, 2);
  assert.match(errors[0] ?? "", /matches 2 rules/);
  assert.match(errors[1] ?? "", /No account rule matches "Unknown.csv"/);
});
