import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COMMANDS } from "./commands";

function defaultKeys(commandId: string): string[] {
  const command = DEFAULT_COMMANDS.find(
    (candidate) => candidate.id === commandId,
  );
  assert.ok(command, `missing command ${commandId}`);
  return command.defaultBindings.map((binding) => binding.key);
}

test("undo and redo commands expose all default keyboard aliases", () => {
  assert.deepEqual(defaultKeys("global.undo"), ["Ctrl+Z", "Meta+Z"]);
  assert.deepEqual(defaultKeys("global.redo"), [
    "Ctrl+Shift+Z",
    "Ctrl+Y",
    "Shift+Meta+Z",
  ]);
});

test("command ids are unique", () => {
  const ids = DEFAULT_COMMANDS.map((command) => command.id);
  assert.deepEqual(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    [],
  );
  assert.equal(new Set(ids).size, ids.length);
});
