/// <reference types="node" />

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { handleEnterSave, shouldHandleEnterSave } from "./enterSave";

function keyEvent(
  overrides: Partial<Parameters<typeof shouldHandleEnterSave>[0]> = {},
) {
  let prevented = false;
  return {
    event: {
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: null,
      preventDefault: () => {
        prevented = true;
      },
      ...overrides,
    },
    wasPrevented: () => prevented,
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "Element");
});

test("plain Enter is handled and prevents default before saving", () => {
  const { event, wasPrevented } = keyEvent();
  let saves = 0;

  assert.equal(
    handleEnterSave(event, () => saves++),
    true,
  );

  assert.equal(saves, 1);
  assert.equal(wasPrevented(), true);
});

test("modified Enter and composing Enter are ignored", () => {
  assert.equal(shouldHandleEnterSave(keyEvent({ ctrlKey: true }).event), false);
  assert.equal(
    shouldHandleEnterSave(keyEvent({ shiftKey: true }).event),
    false,
  );
  assert.equal(
    shouldHandleEnterSave(
      keyEvent({ nativeEvent: { isComposing: true } }).event,
    ),
    false,
  );
});

test("Enter from nested buttons is ignored", () => {
  class FakeElement {
    closest(selector: string) {
      return selector.includes("button") ? this : null;
    }
  }
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement,
  });

  const { event, wasPrevented } = keyEvent({
    target: new FakeElement() as unknown as EventTarget,
  });
  let saves = 0;

  assert.equal(
    handleEnterSave(event, () => saves++),
    false,
  );

  assert.equal(saves, 0);
  assert.equal(wasPrevented(), false);
});
