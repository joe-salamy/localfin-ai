import assert from "node:assert/strict";
import test from "node:test";
import { calculateExpression } from "./calculator.js";

void test("calculateExpression honors arithmetic precedence and grouping", () => {
  assert.equal(calculateExpression("2 + 3 * 4"), 14);
  assert.equal(calculateExpression("-(2 + 3)^2"), -25);
  assert.equal(calculateExpression("2^3^2"), 512);
  assert.equal(calculateExpression("10 % 3"), 1);
  assert.equal(calculateExpression("1.5e2 / 3"), 50);
});

void test("calculateExpression accepts whitespace and normalizes negative zero", () => {
  assert.equal(calculateExpression("  - ( 2 - 2 )  "), 0);
});

void test("calculateExpression rejects unsupported or non-finite expressions", () => {
  for (const expression of [
    "",
    "1 / 0",
    "1 +",
    "Math.max(1, 2)",
    "2(3)",
    "1e",
    "1e309",
  ]) {
    assert.throws(() => calculateExpression(expression));
  }
});

void test("calculateExpression enforces input complexity limits", () => {
  const deeplyNested = `${"(".repeat(33)}1${")".repeat(33)}`;
  const tooManyTokens = `${"1+".repeat(65)}1`;

  assert.throws(
    () => calculateExpression(deeplyNested),
    /parenthesis limit/,
  );
  assert.throws(() => calculateExpression(tooManyTokens), /token limit/);
  assert.throws(() => calculateExpression("1".repeat(257)), /character limit/);
});
