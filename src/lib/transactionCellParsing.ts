import type { Category, Subcategory, Tag, TransactionKind } from "@/types";

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
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
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

  const displayMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(
    trimmed,
  );
  if (!displayMatch) return null;

  const month = Number(displayMatch[1]);
  const day = Number(displayMatch[2]);
  const yearPart = Number(displayMatch[3]);
  const year = displayMatch[3].length === 2 ? 2000 + yearPart : yearPart;
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
): string | null {
  const normalized = normaliseClipboardValue(value);
  if (!normalized) return null;

  const direct = subcategories.find(
    (subcategory) =>
      subcategory.id.toLowerCase() === normalized ||
      subcategory.name.toLowerCase() === normalized,
  );
  if (direct) return direct.id;

  const parts = value
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const categoryName = normaliseClipboardValue(parts[0]);
    const subcategoryName = normaliseClipboardValue(parts[parts.length - 1]);
    const category = categories.find(
      (cat) => cat.name.toLowerCase() === categoryName,
    );
    const scoped = subcategories.find(
      (subcategory) =>
        subcategory.category_id === category?.id &&
        subcategory.name.toLowerCase() === subcategoryName,
    );
    if (scoped) return scoped.id;
  }

  return null;
}

export function resolveTagIds(value: string, tags: Tag[]): string[] {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const selected: string[] = [];
  for (const token of tokens) {
    const normalized = normaliseClipboardValue(token);
    const tag = tags.find(
      (item) =>
        item.id.toLowerCase() === normalized ||
        item.name.toLowerCase() === normalized,
    );
    if (tag && !selected.includes(tag.id)) selected.push(tag.id);
  }
  return selected;
}
