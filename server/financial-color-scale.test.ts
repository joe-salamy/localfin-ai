import assert from "node:assert/strict";
import test from "node:test";
import {
  accountChangeScaleValue,
  categoryDifferenceScaleValue,
  scaleValueColorClass,
  transactionAmountScaleValue,
} from "../src/lib/financialColorScale.js";

test("account change scale treats liability decreases as positive", () => {
  assert.equal(accountChangeScaleValue(50, "asset"), 50);
  assert.equal(accountChangeScaleValue(-50, "asset"), -50);
  assert.equal(accountChangeScaleValue(50, "liability"), -50);
  assert.equal(accountChangeScaleValue(-50, "liability"), 50);
});

test("category difference scale treats income shortfalls as negative", () => {
  assert.equal(categoryDifferenceScaleValue(25, "expense"), 25);
  assert.equal(categoryDifferenceScaleValue(-25, "expense"), -25);
  assert.equal(categoryDifferenceScaleValue(25, "income"), -25);
  assert.equal(categoryDifferenceScaleValue(-25, "income"), 25);
});

test("transaction amount scale follows transaction kind", () => {
  assert.equal(transactionAmountScaleValue(-40, "income"), 40);
  assert.equal(transactionAmountScaleValue(40, "income"), 40);
  assert.equal(transactionAmountScaleValue(-40, "expense"), -40);
  assert.equal(transactionAmountScaleValue(40, "expense"), -40);
  assert.equal(transactionAmountScaleValue(40, "transfer"), null);
  assert.equal(transactionAmountScaleValue(-40, "adjustment"), null);
});

test("scale value color class maps positive to green and negative to red", () => {
  assert.equal(scaleValueColorClass(1), "text-green-400");
  assert.equal(scaleValueColorClass(0), "text-green-400");
  assert.equal(scaleValueColorClass(-1), "text-red-400");
});
