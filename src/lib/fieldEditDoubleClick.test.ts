/// <reference types="node" />

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
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

  assert.equal(
    shouldHandleFieldEditDoubleClick({
      target: new FakeElement() as unknown as EventTarget,
    }),
    true,
  );
});

test("defaultPrevented events are ignored", () => {
  assert.equal(
    shouldHandleFieldEditDoubleClick({ defaultPrevented: true, target: null }),
    false,
  );
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
    assert.equal(
      shouldHandleFieldEditDoubleClick({
        target: new FakeElement(ignoredSelector) as unknown as EventTarget,
      }),
      false,
      ignoredSelector,
    );
  }
});

test("plain object targets are handled without global Element", () => {
  Reflect.deleteProperty(globalThis, "Element");

  assert.equal(
    shouldHandleFieldEditDoubleClick({ target: {} as EventTarget }),
    true,
  );
});
