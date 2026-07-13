import { format, isValid, parse } from "date-fns";
import type { AccountType, Category, Subcategory, Tag, TransactionKind } from "@shared/contracts";
import { normalizeTransactionAmount } from "@shared/finance/transactionAmounts";
import { kindHasSubcategory, parsePastedAmount, parsePastedDate, resolveAccountId, resolveKind, resolveSubcategoryId, resolveTagIds } from "@/lib/transactionCellParsing";
import type { TransactionCellField } from "@/lib/transactionCellParsing";

// ── Row type ──────────────────────────────────────────────────────────

export interface TransactionRow {
  id: string;
  date: string;
  name: string;
  amount: string;
  kind: TransactionKind;
  account_id: string;
  subcategory_id: string;
  tag_ids: string[];
  comment: string;
  isDuplicate: boolean;
  transferMatch: unknown | null;
  categorizationSource: "lookup" | "transfer" | "ai" | "none" | "manual";
  aiSuggestedSubcategoryId: string | null;
}

export interface DraftSnapshot {
  rows: TransactionRow[];
  duplicatesChecked: boolean;
  parseSummary: string | null;
  statementText: string;
  statementAccountId: string;
}

export function emptyRow(): TransactionRow {
  return {
    id: crypto.randomUUID(),
    date: "",
    name: "",
    amount: "",
    kind: "expense",
    account_id: "",
    subcategory_id: "",
    tag_ids: [],
    comment: "",
    isDuplicate: false,
    transferMatch: null,
    categorizationSource: "manual",
    aiSuggestedSubcategoryId: null,
  };
}

export function initialRows(count = 5): TransactionRow[] {
  return Array.from({ length: count }, () => emptyRow());
}

export function cloneRows(rows: TransactionRow[]): TransactionRow[] {
  return rows.map((row) => ({ ...row, tag_ids: [...row.tag_ids] }));
}

// ── Helpers ───────────────────────────────────────────────────────────

export function isRowFilled(row: TransactionRow) {
  return row.date || row.name || row.amount || row.account_id;
}

export function isRowValid(row: TransactionRow) {
  return row.date && row.name && row.amount && row.account_id;
}

export function parseDisplayDate(displayDate: string): Date | null {
  const parsed = parse(displayDate, "MM/dd/yyyy", new Date());
  return isValid(parsed) && format(parsed, "MM/dd/yyyy") === displayDate
    ? parsed
    : null;
}

export function displayAmountToNumber(val: string): number {
  const cleaned = val.replace(/[$,\s]/g, "");
  return parseFloat(cleaned) || 0;
}

export function formatAmountDisplay(
  val: string,
  accountType?: AccountType,
  kind: TransactionKind = "expense",
): string {
  const num = accountType
    ? normalizeTransactionAmount(displayAmountToNumber(val), accountType, kind)
    : displayAmountToNumber(val);
  if (!num && val === "") return "";
  const negative = num < 0;
  const abs = Math.abs(num).toFixed(2);
  return negative ? `-${abs}` : abs;
}

export function toApiDate(displayDate: string): string {
  const parsed = parseDisplayDate(displayDate);
  if (!parsed) {
    throw new Error("Invalid transaction date.");
  }
  return format(parsed, "yyyy-MM-dd");
}

export function getAccountType(
  accountId: string,
  accounts: { id: string; type: AccountType }[],
): AccountType | undefined {
  return accounts.find((account) => account.id === accountId)?.type;
}

export function normalizeRowAmountDisplay(
  row: TransactionRow,
  accounts: { id: string; type: AccountType }[],
): string {
  return formatAmountDisplay(
    row.amount,
    getAccountType(row.account_id, accounts),
    row.kind,
  );
}

export type CellApplyMode = "paste" | "clear";

export interface CellApplyResult {
  row: TransactionRow;
  applied: boolean;
}

export function applyCellValue(
  row: TransactionRow,
  field: TransactionCellField,
  value: string,
  accounts: { id: string; name: string; type: AccountType }[],
  categories: Category[],
  subcategories: Subcategory[],
  tags: Tag[],
  mode: CellApplyMode,
): CellApplyResult {
  if (mode === "clear") {
    if (field === "kind") return { row, applied: false };
    if (field === "date")
      return { row: { ...row, date: "" }, applied: row.date !== "" };
    if (field === "name")
      return { row: { ...row, name: "" }, applied: row.name !== "" };
    if (field === "amount")
      return { row: { ...row, amount: "" }, applied: row.amount !== "" };
    if (field === "account_id") {
      return {
        row: { ...row, account_id: "" },
        applied: row.account_id !== "",
      };
    }
    if (field === "subcategory_id") {
      return {
        row: {
          ...row,
          subcategory_id: "",
          categorizationSource:
            row.categorizationSource === "ai"
              ? "manual"
              : row.categorizationSource,
        },
        applied: row.subcategory_id !== "",
      };
    }
    if (field === "tag_ids") {
      return { row: { ...row, tag_ids: [] }, applied: row.tag_ids.length > 0 };
    }
    return { row: { ...row, comment: "" }, applied: row.comment !== "" };
  }

  if (field === "date") {
    const parsedDate = parsePastedDate(value);
    return parsedDate
      ? { row: { ...row, date: parsedDate.displayDate }, applied: true }
      : { row, applied: false };
  }

  if (field === "name") {
    const name = value.trim();
    return name
      ? { row: { ...row, name }, applied: true }
      : { row, applied: false };
  }

  if (field === "amount") {
    const amount = parsePastedAmount(value);
    return amount === null
      ? { row, applied: false }
      : {
          row: {
            ...row,
            amount: formatAmountDisplay(
              String(amount),
              getAccountType(row.account_id, accounts),
              row.kind,
            ),
          },
          applied: true,
        };
  }

  if (field === "kind") {
    const kind = resolveKind(value);
    return kind
      ? {
          row: {
            ...row,
            kind,
            amount: formatAmountDisplay(
              row.amount,
              getAccountType(row.account_id, accounts),
              kind,
            ),
            subcategory_id: kindHasSubcategory(kind) ? row.subcategory_id : "",
          },
          applied: true,
        }
      : { row, applied: false };
  }

  if (field === "comment") {
    return { row: { ...row, comment: value }, applied: true };
  }

  if (field === "account_id") {
    const accountId = resolveAccountId(value, accounts);
    return accountId
      ? {
          row: {
            ...row,
            account_id: accountId,
            amount: formatAmountDisplay(
              row.amount,
              getAccountType(accountId, accounts),
              row.kind,
            ),
          },
          applied: true,
        }
      : { row, applied: false };
  }

  if (field === "tag_ids") {
    const tagIds = resolveTagIds(value, tags);
    return tagIds.length > 0
      ? { row: { ...row, tag_ids: tagIds }, applied: true }
      : { row, applied: false };
  }

  const subcategoryId = resolveSubcategoryId(value, categories, subcategories);
  return subcategoryId && kindHasSubcategory(row.kind)
    ? {
        row: {
          ...row,
          subcategory_id: subcategoryId,
          categorizationSource:
            row.categorizationSource === "ai"
              ? "manual"
              : row.categorizationSource,
        },
        applied: true,
      }
    : { row, applied: false };
}
