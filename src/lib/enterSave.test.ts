import { afterEach, expect, test } from "vitest"
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

  expect(handleEnterSave(event, () => saves++)).toBe(true);

  expect(saves).toBe(1);
  expect(wasPrevented()).toBe(true);
});

test("modified Enter and composing Enter are ignored", () => {
  expect(shouldHandleEnterSave(keyEvent({ ctrlKey: true }).event)).toBe(false);
  expect(shouldHandleEnterSave(keyEvent({ shiftKey: true }).event)).toBe(false);
  expect(shouldHandleEnterSave(
    keyEvent({ nativeEvent: { isComposing: true } }).event,
  )).toBe(false);
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

  expect(handleEnterSave(event, () => saves++)).toBe(false);

  expect(saves).toBe(0);
  expect(wasPrevented()).toBe(false);
});
