import assert from "node:assert/strict";
import test from "node:test";
import { parseShortcut, validateShortcut, displayShortcut, isSingleCharacterShortcut } from "../../src/features/shortcuts/normalize.js";

test("shortcut parsing canonicalizes modifier order and aliases", () => {
  assert.deepEqual(parseShortcut("alt+ctrl+d"), { key: "Ctrl+Alt+D" });
  assert.deepEqual(parseShortcut("Command+Option+Shift+,"), { key: "Alt+Shift+Meta+," });
});

test("reserved browser shortcuts are rejected", () => {
  const validation = validateShortcut({ key: "Ctrl+R" }, "global");

  assert.equal(validation.ok, false);
  assert.match(validation.message ?? "", /reserved/i);
});

test("global single-character shortcuts are rejected but scoped ones are valid", () => {
  const binding = { key: "Space" };

  assert.equal(isSingleCharacterShortcut({ key: "A" }), true);
  assert.equal(validateShortcut({ key: "A" }, "global").ok, false);
  assert.equal(validateShortcut(binding, "transactionHistoryTable").ok, true);
});

test("shortcut display returns unassigned for missing bindings", () => {
  assert.equal(displayShortcut(null), "Unassigned");
});
