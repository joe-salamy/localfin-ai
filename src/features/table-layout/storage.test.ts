/// <reference types="node" />

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  resetAllTableColumnWidths,
  readAllTableColumnWidths,
  readTableColumnWidths,
  writeTableColumnWidths,
  subscribeToTableColumnWidthReset,
} from "./storage";

const STORAGE_KEY = "localfin.table-column-widths.v1";

class MemoryStorage {
  items: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.items[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.items[key] = value;
  }

  removeItem(key: string): void {
    delete this.items[key];
  }
}

class ThrowingStorage extends MemoryStorage {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("invalid JSON falls back to defaults", () => {
  storage.setItem(STORAGE_KEY, "not-json");

  const result = readAllTableColumnWidths();

  assert.equal(result.version, 1);
  assert.deepEqual(result.tables, {});
});

test("unavailable storage operations fall back without throwing", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new ThrowingStorage(),
  });

  assert.deepEqual(readAllTableColumnWidths().tables, {});
  assert.doesNotThrow(() => writeTableColumnWidths("manual", { name: 176 }));
  assert.doesNotThrow(() => resetAllTableColumnWidths());
});

test("resets all persisted widths and notifies subscribers", () => {
  writeTableColumnWidths("first", { name: 180 });
  writeTableColumnWidths("second", { date: 112 });

  let resetCount = 0;
  const unsubscribe = subscribeToTableColumnWidthReset(() => {
    resetCount += 1;
  });

  resetAllTableColumnWidths();

  assert.deepEqual(readAllTableColumnWidths().tables, {});
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(resetCount, 1);

  unsubscribe();
  resetAllTableColumnWidths();
  assert.equal(resetCount, 1);
});

test("reset falls back to an empty width payload when removeItem is unavailable", () => {
  const items: Record<string, string> = {};
  const storageWithoutRemoveItem = {
    getItem(key: string): string | null {
      return items[key] ?? null;
    },
    setItem(key: string, value: string): void {
      items[key] = value;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storageWithoutRemoveItem,
  });

  writeTableColumnWidths("manual", { name: 176 });
  resetAllTableColumnWidths();

  const payload = JSON.parse(
    storageWithoutRemoveItem.getItem(STORAGE_KEY) ?? "",
  );
  assert.deepEqual(payload.tables, {});
  assert.equal(payload.version, 1);
});

test("persists widths per table without overwriting siblings", () => {
  writeTableColumnWidths("first", { name: 180, amount: 96 });
  writeTableColumnWidths("second", { date: 112 });

  assert.deepEqual(readTableColumnWidths("first"), { name: 180, amount: 96 });
  assert.deepEqual(readTableColumnWidths("second"), { date: 112 });
});

test("sanitizes non-finite writes before persistence", () => {
  writeTableColumnWidths("manual", {
    name: 176,
    tiny: 24,
    infinite: Infinity,
  });

  assert.deepEqual(readTableColumnWidths("manual"), { name: 176 });
});

test("sanitizes non-finite and undersized widths", () => {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      tables: {
        manual: {
          name: 176,
          tiny: 24,
          infinite: Infinity,
          text: "wide",
        },
      },
    }),
  );

  assert.deepEqual(readTableColumnWidths("manual"), { name: 176 });
});
