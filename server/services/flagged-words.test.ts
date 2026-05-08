import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlaggedWordsSettings,
  findFlaggedWords,
  normalizeFlaggedWords,
} from "../../src/features/flagged-words/storage.js";

test("flagged words normalize whitespace, case, empties, and duplicates", () => {
  assert.deepEqual(
    normalizeFlaggedWords([" Interest ", "", "interest", "FEE", "fee"]),
    ["interest", "fee"],
  );
});

test("flagged word matching is case-insensitive and ignores invalid entries", () => {
  assert.deepEqual(
    findFlaggedWords("Monthly ATM Fee", ["", " FEE ", "Interest"]),
    ["fee"],
  );
});

test("flagged word matching does not match inside a larger word", () => {
  assert.deepEqual(
    findFlaggedWords("Coffee shop", ["fee"]),
    [],
  );
  assert.deepEqual(
    findFlaggedWords("Coffee shop fee", ["fee"]),
    ["fee"],
  );
});

test("flagged word settings keep a consistent timestamp for state and storage", () => {
  assert.deepEqual(
    buildFlaggedWordsSettings([" Fee "], "2026-05-08T12:00:00.000Z"),
    {
      version: 1,
      updatedAt: "2026-05-08T12:00:00.000Z",
      words: ["fee"],
    },
  );
});
