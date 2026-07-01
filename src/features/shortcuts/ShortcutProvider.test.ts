import assert from "node:assert/strict";
import test from "node:test";
import { shouldSkipShortcutDispatch } from "./dispatch";

test("default-prevented shortcut events are not dispatched", () => {
  assert.equal(
    shouldSkipShortcutDispatch(
      { defaultPrevented: true, target: null },
      { key: "Ctrl+Z" },
    ),
    true,
  );
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
    assert.equal(
      shouldSkipShortcutDispatch(
        { defaultPrevented: false, target },
        { key: "Delete" },
      ),
      true,
    );
    assert.equal(
      shouldSkipShortcutDispatch(
        { defaultPrevented: false, target },
        { key: "Ctrl+Z" },
      ),
      false,
    );
  } finally {
    if (originalElementDescriptor) {
      Object.defineProperty(globalThis, "Element", originalElementDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Element");
    }
  }
});
