import type { Category, Subcategory, Tag, TransactionKind } from "@shared/contracts"

export type TransactionCellField =
  | "date"
  | "name"
  | "amount"
  | "kind"
  | "account_id"
  | "subcategory_id"
  | "tag_ids"
  | "comment";

export type HistoryTransactionCellField = Exclude<
  TransactionCellField,
  "account_id"
>;

export const addTransactionCellFields: readonly TransactionCellField[] = [
  "date",
  "name",
  "amount",
  "kind",
  "account_id",
  "subcategory_id",
  "tag_ids",
  "comment",
];

export const historyTransactionCellFields: readonly HistoryTransactionCellField[] =
  ["date", "name", "amount", "kind", "subcategory_id", "tag_ids", "comment"];

export function normaliseClipboardValue(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveKind(value: string): TransactionKind | null {
  const normalized = normaliseClipboardValue(value);
  if (
    normalized === "income" ||
    normalized === "expense" ||
    normalized === "transfer" ||
    normalized === "adjustment"
  ) {
    return normalized;
  }
  return null;
}

export function kindHasSubcategory(kind: TransactionKind): boolean {
  return kind !== "transfer" && kind !== "adjustment";
}

export function parsePastedAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Keep comma grouping strict: commas may only separate complete three-digit
  // groups, while ungrouped amounts may contain one decimal point and up to
  // two decimal places.
  const match =
    /^([+-]?)\$?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)$/.exec(
      trimmed,
    );
  if (!match) return null;

  const amount = Number(trimmed.replace("$", "").replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatDateParts(year: number, month: number, day: number) {
  const displayDate = `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
  const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { displayDate, isoDate };
}

export function parsePastedDate(
  value: string,
): { displayDate: string; isoDate: string } | null {
  const trimmed = value.trim();
  if (!trimmed || /[A-Za-z]/.test(trimmed)) return null;

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isRealDate(year, month, day)
      ? formatDateParts(year, month, day)
      : null;
  }

  const displayMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(
    trimmed,
  );
  if (!displayMatch) return null;

  const month = Number(displayMatch[1]);
  const day = Number(displayMatch[2]);
  const year = Number(displayMatch[3]);
  return isRealDate(year, month, day)
    ? formatDateParts(year, month, day)
    : null;
}

export function resolveAccountId(
  value: string,
  accounts: { id: string; name: string }[],
): string | null {
  const normalized = normaliseClipboardValue(value);
  if (!normalized) return null;
  return (
    accounts.find(
      (account) =>
        account.id.toLowerCase() === normalized ||
        account.name.toLowerCase() === normalized,
    )?.id ?? null
  );
}

export function resolveSubcategoryId(
  value: string,
  categories: Category[],
  subcategories: Subcategory[],
  currentCategoryId?: string | null,
): string | null {
  const normalized = normaliseClipboardValue(value);
  if (!normalized) return null;

  const direct = subcategories.find(
    (subcategory) => subcategory.id.toLowerCase() === normalized,
  );
  if (direct) return direct.id;

  const parts = value
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const categoryName = normaliseClipboardValue(parts[0] ?? "");
    const subcategoryName = normaliseClipboardValue(parts.at(-1) ?? "");
    const categoryIds = categories
      .filter((category) => category.name.toLowerCase() === categoryName)
      .map((category) => category.id);
    const scoped = subcategories.filter(
      (subcategory) =>
        categoryIds.includes(subcategory.category_id) &&
        subcategory.name.toLowerCase() === subcategoryName,
    );
    return scoped.length === 1 ? scoped[0]?.id ?? null : null;
  }

  const matches = subcategories.filter(
    (subcategory) => subcategory.name.toLowerCase() === normalized,
  );
  if (currentCategoryId) {
    const scoped = matches.filter(
      (subcategory) => subcategory.category_id === currentCategoryId,
    );
    if (scoped.length > 0) {
      return scoped.length === 1 ? scoped[0]?.id ?? null : null;
    }
  }

  return matches.length === 1 ? matches[0]?.id ?? null : null;
}

export interface ResolvedTagIds {
  tagIds: string[];
  unknown: string[];
}

export function resolveTagIds(
  value: string,
  tags: Tag[],
): ResolvedTagIds {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return { tagIds: [], unknown: [] };

  const selected: string[] = [];
  const unknown: string[] = [];
  const unknownKeys = new Set<string>();
  for (const token of tokens) {
    const normalized = normaliseClipboardValue(token);
    const tag = tags.find(
      (item) =>
        item.id.toLowerCase() === normalized ||
        item.name.toLowerCase() === normalized,
    );
    if (tag) {
      if (!selected.includes(tag.id)) selected.push(tag.id);
    } else if (!unknownKeys.has(normalized)) {
      unknownKeys.add(normalized);
      unknown.push(token);
    }
  }
  return { tagIds: selected, unknown };
}

