import { afterEach, beforeEach, expect, test } from "vitest"
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

  expect(result.version).toBe(1);
  expect(result.tables).toEqual({});
});

test("unavailable storage operations fall back without throwing", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new ThrowingStorage(),
  });

  expect(readAllTableColumnWidths().tables).toEqual({});
  expect(() => writeTableColumnWidths("manual", { name: 176 })).not.toThrow();
  expect(() => resetAllTableColumnWidths()).not.toThrow();
});

test("resets all persisted widths and notifies subscribers", () => {
  writeTableColumnWidths("first", { name: 180 });
  writeTableColumnWidths("second", { date: 112 });

  let resetCount = 0;
  const unsubscribe = subscribeToTableColumnWidthReset(() => {
    resetCount += 1;
  });

  resetAllTableColumnWidths();

  expect(readAllTableColumnWidths().tables).toEqual({});
  expect(storage.getItem(STORAGE_KEY)).toBe(null);
  expect(resetCount).toBe(1);

  unsubscribe();
  resetAllTableColumnWidths();
  expect(resetCount).toBe(1);
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
  expect(payload.tables).toEqual({});
  expect(payload.version).toBe(1);
});

test("persists widths per table without overwriting siblings", () => {
  writeTableColumnWidths("first", { name: 180, amount: 96 });
  writeTableColumnWidths("second", { date: 112 });

  expect(readTableColumnWidths("first")).toEqual({ name: 180, amount: 96 });
  expect(readTableColumnWidths("second")).toEqual({ date: 112 });
});

test("sanitizes non-finite writes before persistence", () => {
  writeTableColumnWidths("manual", {
    name: 176,
    tiny: 24,
    infinite: Infinity,
  });

  expect(readTableColumnWidths("manual")).toEqual({ name: 176 });
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

  expect(readTableColumnWidths("manual")).toEqual({ name: 176 });
});
