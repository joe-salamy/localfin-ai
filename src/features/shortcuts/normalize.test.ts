
import { expect, test } from "vitest"
import {
  normalizeShortcutParts,
  parseShortcut,
  shortcutBindingsMatch,
} from "./normalize";

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
    expect({ key: normalizeShortcutParts(parts) }, name).toEqual(expected);
  }
});

test("Cmd+Shift+Z parses to the same normalized redo key as keyboard events", () => {
  expect(parseShortcut("Cmd+Shift+Z")).toEqual({ key: "Shift+Meta+Z" });
});

test("shortcut binding lists only match when every key matches in order", () => {
  expect(shortcutBindingsMatch([{ key: "Ctrl+K" }], [{ key: "Ctrl+K" }])).toBe(true);
  expect(shortcutBindingsMatch([{ key: "Ctrl+K" }], [{ key: "Ctrl+J" }])).toBe(false);
  expect(shortcutBindingsMatch(
    [{ key: "Ctrl+K" }, { key: "Ctrl+Shift+K" }],
    [{ key: "Ctrl+K" }],
  )).toBe(false);
});
