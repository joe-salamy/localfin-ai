import { afterEach, beforeEach, expect, test } from "vitest"
import {
  defaultDisplaySettings,
  readDisplaySettings,
  writeDisplaySettings,
} from "./storage";

const STORAGE_KEY = "localfin.display.v1";

class MemoryStorage {
  items: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.items[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.items[key] = value;
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

test("missing storage enables success confirmation popups", () => {
  const result = readDisplaySettings();

  expect(result.successConfirmationPopupsEnabled).toBe(true);
});

test("old stored settings enable success confirmations while preserving amount colors", () => {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      amountGradientEnabled: true,
      negativeColor: "#111111",
      neutralColor: "#222222",
      positiveColor: "#333333",
    }),
  );

  const result = readDisplaySettings();

  expect(result.successConfirmationPopupsEnabled).toBe(true);
  expect(result.amountGradientEnabled).toBe(true);
  expect(result.negativeColor).toBe("#111111");
  expect(result.neutralColor).toBe("#222222");
  expect(result.positiveColor).toBe("#333333");
});

test("stored false disables success confirmation popups", () => {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      amountGradientEnabled: false,
      negativeColor: "#dc2626",
      neutralColor: "#ffffff",
      positiveColor: "#16a34a",
      successConfirmationPopupsEnabled: false,
    }),
  );

  const result = readDisplaySettings();

  expect(result.successConfirmationPopupsEnabled).toBe(false);
});

test("writes disabled success confirmation popups", () => {
  writeDisplaySettings({
    ...defaultDisplaySettings(),
    successConfirmationPopupsEnabled: false,
  });

  const raw = storage.getItem(STORAGE_KEY);
  expect(raw !== null).toBeTruthy();

  const persisted = JSON.parse(raw!);
  expect(persisted.successConfirmationPopupsEnabled).toBe(false);
});
