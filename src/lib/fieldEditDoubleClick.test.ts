import { afterEach, expect, test } from "vitest"
import { shouldHandleFieldEditDoubleClick } from "./fieldEditDoubleClick";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "Element");
});

class FakeElement {
  private readonly matchingSelector: string | null;

  constructor(matchingSelector: string | null = null) {
    this.matchingSelector = matchingSelector;
  }
  closest(selector: string) {
    return this.matchingSelector != null &&
      selector
        .split(",")
        .map((part) => part.trim())
        .includes(this.matchingSelector)
      ? this
      : null;
  }
}

function installFakeElement() {
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement,
  });
}

test("plain non-interactive targets are handled", () => {
  installFakeElement();

  expect(shouldHandleFieldEditDoubleClick({
    target: new FakeElement() as unknown as EventTarget,
  })).toBe(true);
});

test("defaultPrevented events are ignored", () => {
  expect(shouldHandleFieldEditDoubleClick({ defaultPrevented: true, target: null })).toBe(false);
});

test("nested ignored targets are ignored", () => {
  installFakeElement();

  const ignoredSelectors = [
    "button",
    "a",
    "input",
    "textarea",
    "select",
    '[role="button"]',
    '[role="link"]',
    '[contenteditable="true"]',
    '[data-field-edit-double-click-ignore="true"]',
  ];

  for (const ignoredSelector of ignoredSelectors) {
    expect(shouldHandleFieldEditDoubleClick({
      target: new FakeElement(ignoredSelector) as unknown as EventTarget,
    }), ignoredSelector).toBe(false);
  }
});

test("plain object targets are handled without global Element", () => {
  Reflect.deleteProperty(globalThis, "Element");

  expect(shouldHandleFieldEditDoubleClick({ target: {} as EventTarget })).toBe(true);
});
