/// <reference types="node" />

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
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

  assert.equal(result.successConfirmationPopupsEnabled, true);
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

  assert.equal(result.successConfirmationPopupsEnabled, true);
  assert.equal(result.amountGradientEnabled, true);
  assert.equal(result.negativeColor, "#111111");
  assert.equal(result.neutralColor, "#222222");
  assert.equal(result.positiveColor, "#333333");
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

  assert.equal(result.successConfirmationPopupsEnabled, false);
});

test("writes disabled success confirmation popups", () => {
  writeDisplaySettings({
    ...defaultDisplaySettings(),
    successConfirmationPopupsEnabled: false,
  });

  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw !== null);

  const persisted = JSON.parse(raw);
  assert.equal(persisted.successConfirmationPopupsEnabled, false);
});
