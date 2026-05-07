import assert from "node:assert/strict";
import test from "node:test";
import {
  createUniqueSubcategoryNameMap,
  normalizeAIResultIndex,
} from "./ai.js";

test("AI categorization accepts zero-based result indexes", () => {
  assert.equal(normalizeAIResultIndex(0, 25, false), 0);
  assert.equal(normalizeAIResultIndex(24, 25, false), 24);
});

test("AI categorization normalizes one-based result indexes", () => {
  assert.equal(normalizeAIResultIndex(1, 25, true), 0);
  assert.equal(normalizeAIResultIndex(25, 25, true), 24);
});

test("AI categorization rejects indexes outside the batch", () => {
  assert.equal(normalizeAIResultIndex(25, 25, false), null);
  assert.equal(normalizeAIResultIndex(26, 25, true), null);
  assert.equal(normalizeAIResultIndex("1", 25, true), null);
});

test("AI categorization maps only globally unique subcategory names", () => {
  const map = createUniqueSubcategoryNameMap([
    {
      id: "groceries",
      name: "Groceries",
      category_name: "Food",
      category_type: "expense",
    },
    {
      id: "income-unassigned",
      name: "Unassigned",
      category_name: "Income",
      category_type: "income",
    },
    {
      id: "expense-unassigned",
      name: "Unassigned",
      category_name: "Expense",
      category_type: "expense",
    },
  ]);

  assert.equal(map.get("groceries")?.id, "groceries");
  assert.equal(map.has("unassigned"), false);
});
