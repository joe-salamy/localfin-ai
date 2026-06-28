/// <reference types="node" />

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  readAllTableColumnWidths,
  readTableColumnWidths,
  writeTableColumnWidths,
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
}

class ThrowingStorage extends MemoryStorage {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
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
