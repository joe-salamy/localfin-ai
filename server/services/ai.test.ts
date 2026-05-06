import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAIResultIndex } from "./ai.js";

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
