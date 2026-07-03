import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShortcutParts, parseShortcut } from "./normalize";

test("shortcut normalization emits exact undo and redo key names", () => {
  const cases = [
    {
      name: "Ctrl+Z undo",
      parts: { key: "z", ctrl: true, alt: false, shift: false, meta: false },
      expected: { key: "Ctrl+Z" },
    },
    {
      name: "Meta+Z undo",
      parts: { key: "z", ctrl: false, alt: false, shift: false, meta: true },
      expected: { key: "Meta+Z" },
    },
    {
      name: "Ctrl+Shift+Z redo",
      parts: { key: "z", ctrl: true, alt: false, shift: true, meta: false },
      expected: { key: "Ctrl+Shift+Z" },
    },
    {
      name: "Meta+Shift+Z redo normalized to modifier order",
      parts: { key: "z", ctrl: false, alt: false, shift: true, meta: true },
      expected: { key: "Shift+Meta+Z" },
    },
    {
      name: "Ctrl+Y redo",
      parts: { key: "y", ctrl: true, alt: false, shift: false, meta: false },
      expected: { key: "Ctrl+Y" },
    },
  ] as const;

  for (const { name, parts, expected } of cases) {
    assert.deepEqual({ key: normalizeShortcutParts(parts) }, expected, name);
  }
});

test("Cmd+Shift+Z parses to the same normalized redo key as keyboard events", () => {
  assert.deepEqual(parseShortcut("Cmd+Shift+Z"), { key: "Shift+Meta+Z" });
});
