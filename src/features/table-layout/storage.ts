const STORAGE_KEY = "localfin.table-column-widths.v1";
const STORAGE_VERSION = 1;
const MIN_STORED_COLUMN_WIDTH_PX = 48;

const resetSubscribers = new Set<() => void>();

interface BrowserStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export interface StoredTableColumnWidths {
  version: number;
  updatedAt: string;
  tables: Record<string, Record<string, number>>;
}

export function defaultTableColumnWidths(): StoredTableColumnWidths {
  return {
    version: STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    tables: {},
  };
}

export function subscribeToTableColumnWidthReset(
  listener: () => void,
): () => void {
  resetSubscribers.add(listener);
  return () => {
    resetSubscribers.delete(listener);
  };
}

function isBrowserStorage(value: unknown): value is BrowserStorage {
  return (
    value !== null &&
    typeof value === "object" &&
    "getItem" in value &&
    typeof value.getItem === "function" &&
    "setItem" in value &&
    typeof value.setItem === "function"
  );
}

function getTableColumnWidthStorage(): BrowserStorage | null {
  if (!("localStorage" in globalThis)) return null;
  const storage = globalThis.localStorage;
  return isBrowserStorage(storage) ? storage : null;
}

function sanitizeWidths(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object") return {};

  const widths: Record<string, number> = {};
  for (const [columnId, width] of Object.entries(value)) {
    if (typeof width !== "number") continue;
    if (!Number.isFinite(width)) continue;
    if (width < MIN_STORED_COLUMN_WIDTH_PX) continue;
    widths[columnId] = width;
  }
  return widths;
}

function sanitizeTables(
  value: unknown,
): Record<string, Record<string, number>> {
  if (value === null || typeof value !== "object") return {};

  const tables: Record<string, Record<string, number>> = {};
  for (const [tableId, widths] of Object.entries(value)) {
    tables[tableId] = sanitizeWidths(widths);
  }
  return tables;
}

export function readAllTableColumnWidths(): StoredTableColumnWidths {
  const storage = getTableColumnWidthStorage();
  if (!storage) return defaultTableColumnWidths();

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return defaultTableColumnWidths();
  }
  if (!raw) return defaultTableColumnWidths();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("tables" in parsed)
    ) {
      return defaultTableColumnWidths();
    }

    const defaults = defaultTableColumnWidths();
    const updatedAt =
      "updatedAt" in parsed && typeof parsed.updatedAt === "string"
        ? parsed.updatedAt
        : defaults.updatedAt;

    return {
      version: STORAGE_VERSION,
      updatedAt,
      tables: sanitizeTables(parsed.tables),
    };
  } catch {
    return defaultTableColumnWidths();
  }
}

export function readTableColumnWidths(tableId: string): Record<string, number> {
  return readAllTableColumnWidths().tables[tableId] ?? {};
}

export function writeTableColumnWidths(
  tableId: string,
  widths: Record<string, number>,
): void {
  const storage = getTableColumnWidthStorage();
  if (!storage) return;

  const current = readAllTableColumnWidths();
  const sanitized = sanitizeWidths(widths);
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        updatedAt: new Date().toISOString(),
        tables: {
          ...current.tables,
          [tableId]: sanitized,
        },
      }),
    );
  } catch {
    // Storage can be unavailable even when the API object exists.
  }
}

export function resetAllTableColumnWidths(): void {
  const storage = getTableColumnWidthStorage();
  try {
    if (storage) {
      if (typeof storage.removeItem === "function") {
        storage.removeItem(STORAGE_KEY);
      } else {
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify(defaultTableColumnWidths()),
        );
      }
    }
  } catch {
    // Storage can be unavailable even when the API object exists.
  }

  for (const listener of resetSubscribers) {
    listener();
  }
}
