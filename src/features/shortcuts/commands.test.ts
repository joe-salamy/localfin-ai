
import { expect, test } from "vitest"
import { DEFAULT_COMMANDS } from "./commands";

function defaultKeys(commandId: string): string[] {
  const command = DEFAULT_COMMANDS.find(
    (candidate) => candidate.id === commandId,
  );
  expect(command, `missing command ${commandId}`).toBeTruthy();
  return command!.defaultBindings.map((binding) => binding.key);
}

test("undo and redo commands expose all default keyboard aliases", () => {
  expect(defaultKeys("global.undo")).toEqual(["Ctrl+Z", "Meta+Z"]);
  expect(defaultKeys("global.redo")).toEqual([
    "Ctrl+Shift+Z",
    "Ctrl+Y",
    "Shift+Meta+Z",
  ]);
});

test("command ids are unique", () => {
  const ids = DEFAULT_COMMANDS.map((command) => command.id);
  expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  expect(new Set(ids).size).toBe(ids.length);
});
