
import { expect, test } from "vitest"
import { shouldSkipShortcutDispatch } from "./dispatch";

test("default-prevented shortcut events are not dispatched", () => {
  expect(shouldSkipShortcutDispatch(
    { defaultPrevented: true, target: null },
    { key: "Ctrl+Z" },
  )).toBe(true);
});

test("native control keys are skipped on interactive targets without suppressing modified undo keys", () => {
  const originalElementDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "Element",
  );

  class FakeElement extends EventTarget {
    closest() {
      return this;
    }
  }

  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement,
  });
  const target = new FakeElement();

  try {
    expect(shouldSkipShortcutDispatch(
      { defaultPrevented: false, target },
      { key: "Delete" },
    )).toBe(true);
    expect(shouldSkipShortcutDispatch(
      { defaultPrevented: false, target },
      { key: "Ctrl+Z" },
    )).toBe(false);
  } finally {
    if (originalElementDescriptor) {
      Object.defineProperty(globalThis, "Element", originalElementDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Element");
    }
  }
});
