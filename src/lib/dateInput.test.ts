/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePastedDate } from "./transactionCellParsing";
import { formatDateInput } from "./utils";

test("formatDateInput formats eight typed digits as MM/DD/YYYY", () => {
  assert.equal(formatDateInput("01012026"), "01/01/2026");
});

test("formatDateInput normalizes single-digit month and day only when YYYY is present", () => {
  assert.equal(formatDateInput("1/2/2026"), "01/02/2026");
});

test("formatDateInput keeps partial YYYY input usable while typing", () => {
  const typedDigits = [
    { value: "0", expected: "0" },
    { value: "01", expected: "01" },
    { value: "010", expected: "01/0" },
    { value: "0101", expected: "01/01" },
    { value: "01012", expected: "01/01/2" },
    { value: "010120", expected: "01/01/20" },
    { value: "0101202", expected: "01/01/202" },
  ];

  for (const { value, expected } of typedDigits) {
    assert.equal(formatDateInput(value), expected, value);
  }
});

test("formatDateInput does not expand slash-delimited two-digit years", () => {
  assert.equal(formatDateInput("1/2/26"), "1/2/26");
});

test("parsePastedDate accepts display dates with four-digit years", () => {
  assert.deepEqual(parsePastedDate("1/2/2026"), {
    displayDate: "01/02/2026",
    isoDate: "2026-01-02",
  });
});

test("parsePastedDate accepts ISO dates", () => {
  assert.deepEqual(parsePastedDate("2026-01-02"), {
    displayDate: "01/02/2026",
    isoDate: "2026-01-02",
  });
});

test("parsePastedDate rejects display dates with two-digit years", () => {
  assert.equal(parsePastedDate("1/2/26"), null);
});

test("parsePastedDate rejects invalid calendar dates", () => {
  assert.equal(parsePastedDate("02/29/2025"), null);
  assert.equal(parsePastedDate("2026-02-30"), null);
});
