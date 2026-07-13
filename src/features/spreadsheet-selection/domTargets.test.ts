import { afterEach, beforeEach, expect, test } from "vitest"
import { hasSelectedInputText, isNativeEditableTarget } from "./domTargets";

const constructorNames = [
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
] as const;

type ConstructorName = (typeof constructorNames)[number];

let savedDescriptors = {} as Record<ConstructorName, PropertyDescriptor | undefined>;
const globalConstructors = globalThis as typeof globalThis &
  Partial<Record<ConstructorName, unknown>>;

beforeEach(() => {
  savedDescriptors = {} as Record<ConstructorName, PropertyDescriptor | undefined>;

  for (const name of constructorNames) {
    savedDescriptors[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    delete globalConstructors[name];
  }
});

afterEach(() => {
  for (const name of constructorNames) {
    const descriptor = savedDescriptors[name];

    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalConstructors[name];
    }
  }

  savedDescriptors = {} as Record<ConstructorName, PropertyDescriptor | undefined>;
});

test("plain event targets are not editable when DOM constructors are absent", () => {
  expect(isNativeEditableTarget({} as EventTarget)).toBe(false);
});

test("plain event targets have no selected text when DOM constructors are absent", () => {
  expect(hasSelectedInputText({} as EventTarget)).toBe(false);
});
