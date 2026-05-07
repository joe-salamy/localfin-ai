import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COMMANDS } from "../../src/features/shortcuts/commands.js";
import { parseShortcut, validateShortcut, displayShortcut, isSingleCharacterShortcut } from "../../src/features/shortcuts/normalize.js";

function scopesOverlap(left: string, right: string): boolean {
  return left === right || left === "global" || right === "global";
}

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

test("default shortcut bindings are valid and conflict-free", () => {
  for (const command of DEFAULT_COMMANDS) {
    if (!command.defaultBinding) continue;

    assert.equal(
      validateShortcut(command.defaultBinding, command.scope).ok,
      true,
      `${command.id} should have a valid default shortcut`,
    );
  }

  for (let i = 0; i < DEFAULT_COMMANDS.length; i++) {
    for (let j = i + 1; j < DEFAULT_COMMANDS.length; j++) {
      const left = DEFAULT_COMMANDS[i];
      const right = DEFAULT_COMMANDS[j];
      assert.ok(left && right);
      if (!left.defaultBinding || !right.defaultBinding) continue;

      assert.equal(
        left.defaultBinding.key === right.defaultBinding.key && scopesOverlap(left.scope, right.scope),
        false,
        `${left.id} and ${right.id} should not conflict on ${left.defaultBinding.key}`,
      );
    }
  }
});
