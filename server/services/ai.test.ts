import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAvailableSubcategoryChoices,
  buildCategorizationMessages,
  normalizeAIResultIndex,
  resolveSubcategoryChoice,
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

const availableSubcategories = buildAvailableSubcategoryChoices([
  {
    id: "income-unassigned",
    name: "Unassigned",
    category_name: "Unassigned",
    category_type: "income",
  },
  {
    id: "cash-back",
    name: "Cash back",
    category_name: "Other income",
    category_type: "income",
  },
  {
    id: "expense-unassigned",
    name: "Unassigned",
    category_name: "Unassigned",
    category_type: "expense",
  },
  {
    id: "groceries",
    name: "Groceries",
    category_name: "Essentials",
    category_type: "expense",
  },
  {
    id: "duplicate-groceries",
    name: "Groceries",
    category_name: "Travel",
    category_type: "expense",
  },
]);

test("AI categorization resolves numeric subcategory choices", () => {
  assert.equal(
    resolveSubcategoryChoice(0, 100, availableSubcategories)?.id,
    "income-unassigned",
  );
  assert.equal(
    resolveSubcategoryChoice(1, 100, availableSubcategories)?.id,
    "cash-back",
  );
  assert.equal(
    resolveSubcategoryChoice(3, -25, availableSubcategories)?.id,
    "groceries",
  );
});

test("AI categorization falls back to direction-correct Unassigned for invalid choices", () => {
  const invalidChoices: unknown[] = [null, undefined, "3", 3.5, -1, 99];

  for (const choice of invalidChoices) {
    assert.equal(
      resolveSubcategoryChoice(choice, 100, availableSubcategories)?.id,
      "income-unassigned",
    );
    assert.equal(
      resolveSubcategoryChoice(choice, -100, availableSubcategories)?.id,
      "expense-unassigned",
    );
  }
});

test("AI categorization rejects wrong-direction subcategory choices", () => {
  assert.equal(
    resolveSubcategoryChoice(3, 100, availableSubcategories)?.id,
    "income-unassigned",
  );
  assert.equal(
    resolveSubcategoryChoice(1, -100, availableSubcategories)?.id,
    "expense-unassigned",
  );
});

test("AI categorization resolves duplicate names deterministically by number", () => {
  assert.equal(
    resolveSubcategoryChoice(3, -25, availableSubcategories)?.id,
    "groceries",
  );
  assert.equal(
    resolveSubcategoryChoice(4, -25, availableSubcategories)?.id,
    "duplicate-groceries",
  );
});

test("AI categorization prompt asks for numeric subcategory choices", () => {
  const messages = buildCategorizationMessages(
    [
      {
        index: 0,
        name: "Grocery Store",
        account_id: "checking",
        account_name: "Checking",
        amount: -25,
      },
    ],
    availableSubcategories,
    [],
  );

  assert.match(
    messages.systemMessage,
    /0\. \[income\] Unassigned > Unassigned/,
  );
  assert.match(messages.systemMessage, /3\. \[expense\] Essentials > Groceries/);
  assert.match(
    messages.userMessage,
    /"results": \[\{ "index": 0, "subcategory": 0 \}\]/,
  );
  assert.doesNotMatch(messages.userMessage, /subcategory_name/);
});
