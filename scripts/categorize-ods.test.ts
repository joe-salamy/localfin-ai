import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createAccount } from "../server/services/accounts.js";
import { createCategory, createSubcategory } from "../server/services/categories.js";
import { createTransaction } from "../server/services/transactions/create.js";
import { getTransactionById } from "../server/services/transactions/read.js";
import { useTempDatabase } from "../server/tests/helpers.js";
import { applyCategorizeOds } from "./apply-categorize-ods.js";
import { collectCategorizeRows, exportCategorizeOds } from "./export-categorize-ods.js";

void test("categorize export suggests same-kind subcategories and round-trips through apply", async (t) => {
  const dbPath = await useTempDatabase(t, "localfin-categorize-test-");
  const card = createAccount({ name: "Card", type: "liability" });
  const food = createCategory({ name: "Food", type: "expense" });
  const groceries = createSubcategory({ name: "Groceries", category_id: food.id });
  const refunds = createCategory({ name: "Refunds", type: "income" });
  const returns = createSubcategory({ name: "Returns", category_id: refunds.id });
  for (const date of ["2026-01-01", "2026-01-02", "2026-01-03"]) {
    createTransaction({ account_id: card.id, date, name: "SHOP", amount: 5, kind: "income", subcategory_id: returns.id });
    createTransaction({ account_id: card.id, date, name: "MARKET", amount: 20, kind: "expense", subcategory_id: groceries.id });
  }
  const shopPurchase = createTransaction({ account_id: card.id, date: "2026-02-01", name: "SHOP", amount: 30, kind: "expense" });
  const marketPurchase = createTransaction({ account_id: card.id, date: "2026-02-01", name: "MARKET", amount: 25, kind: "expense" });

  const rows = collectCategorizeRows(true, null);
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get(shopPurchase.id)?.subcategoryId, "");
  assert.equal(byId.get(marketPurchase.id)?.subcategoryId, groceries.id);

  const out = path.join(path.dirname(dbPath), "categorize-review.fods");
  const exported = await exportCategorizeOds({ out, needsCategoryOnly: true, limit: null });
  assert.equal(exported.exported, 2);

  const result = applyCategorizeOds(out, false);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.stillNeeding, []);
  assert.equal(getTransactionById(marketPurchase.id)?.subcategory_id, groceries.id);
  assert.equal(getTransactionById(shopPurchase.id)?.subcategory_id, null);
});
