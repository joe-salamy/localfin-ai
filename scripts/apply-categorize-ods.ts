import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import {
  getCategories,
  getSubcategories,
} from "../server/services/categories.js";
import { getTransactionById } from "../server/services/transactions/read.js";
import { checkTransferMatch } from "../server/services/transactions/checks.js";
import { bulkUpdateTransactions } from "../server/services/transactions/bulk.js";
import { isIsoDate } from "../shared/validation.js";
import { REVIEW_HEADER } from "./export-categorize-ods.js";
import { cellAmount, cellText, findSheet, gridOf, readWorkbook } from "./ods-common.js";

const amountSchema = z.number().finite();

interface PendingUpdate {
  rowNumber: number;
  id: string;
  name: string;
  oldLabel: string;
  newLabel: string;
  newSubcategoryId: string | null;
}

export function applyUsage(): string {
  return "Usage: categorize:apply <edited.fods|edited.ods> [--dry-run]";
}

export function parseApplyArgs(argv: string[]): {
  input: string;
  dryRun: boolean;
} | null {
  let input: string | null = null;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") return null;
    else if (arg.startsWith("--")) return null;
    else if (input == null) input = arg;
    else return null;
  }
  if (!input) return null;
  return { input, dryRun };
}

interface CategorizeColumns {
  id: number;
  date: number;
  amount: number;
  subcategory: number;
  subcategoryId: number;
}

export interface ParsedCategorizeWorkbook {
  grid: unknown[][];
  header: string[];
  cols: CategorizeColumns;
  fileLabelToId: Map<string, string>;
  reviewName: string;
}

const REQUIRED_REVIEW_COLUMNS = ["__id", "date", "amount", "subcategory", "__subcategory_id"] as const;

export function parseCategorizeWorkbook(inputPath: string): ParsedCategorizeWorkbook {
  const { resolved, workbook } = readWorkbook(inputPath);
  const reviewName =
    workbook.SheetNames.find((n) => n.toLowerCase() === "review") ??
    workbook.SheetNames[0];
  const review = reviewName ? findSheet(workbook, reviewName) : null;
  if (!reviewName || !review) throw new Error(`No sheets found in ${resolved}`);
  const grid = gridOf(review);
  const header = (grid[0] ?? []).map((h) => cellText(h).toLowerCase());
  const col = (name: string): number => header.indexOf(name);
  const idCol = col("__id");
  const dateCol = col("date");
  const amountCol = col("amount");
  const subcategoryCol = col("subcategory");
  const subcategoryIdCol = col("__subcategory_id");
  if (
    idCol < 0 ||
    dateCol < 0 ||
    amountCol < 0 ||
    subcategoryCol < 0 ||
    subcategoryIdCol < 0
  ) {
    throw new Error(
      `Sheet "${reviewName}" is missing required columns (__id, date, amount, subcategory, __subcategory_id)`,
    );
  }

  const choiceGrid =
    workbook.SheetNames.map((n) => findSheet(workbook, n))
      .map((sheet) => (sheet ? gridOf(sheet) : []))
      .find((sheetGrid) => {
        const first = sheetGrid[0];
        return (
          first != null &&
          cellText(first[0]).toLowerCase() === "label" &&
          cellText(first[1]).toLowerCase() === "id"
        );
      }) ?? null;
  const fileLabelToId = new Map<string, string>();
  if (choiceGrid) {
    for (const row of choiceGrid.slice(1)) {
      const label = cellText(row[0]);
      const id = cellText(row[1]);
      if (label && id && !fileLabelToId.has(label)) fileLabelToId.set(label, id);
    }
  }
  for (const name of REQUIRED_REVIEW_COLUMNS) {
    if (!(REVIEW_HEADER as readonly string[]).includes(name)) {
      throw new Error(`Canonical REVIEW_HEADER is missing required column "${name}"`);
    }
  }

  return {
    grid,
    header,
    cols: {
      id: idCol,
      date: dateCol,
      amount: amountCol,
      subcategory: subcategoryCol,
      subcategoryId: subcategoryIdCol,
    },
    fileLabelToId,
    reviewName,
  };
}

export function validateCategorizeRows(parsed: ParsedCategorizeWorkbook): PendingUpdate[] {
  const {
    grid,
    fileLabelToId,
    cols: {
      id: idCol,
      date: dateCol,
      amount: amountCol,
      subcategory: subcategoryCol,
      subcategoryId: subcategoryIdCol,
    },
  } = parsed;
  void getDb();
  const categories = new Map(getCategories().map((c) => [c.id, c] as const));
  const activeSubcategories = new Map(
    getSubcategories()
      .filter((s) => categories.has(s.category_id))
      .map((s) => [s.id, s] as const),
  );

  const errors: string[] = [];
  const pending: PendingUpdate[] = [];

  grid.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((cell) => cell == null || String(cell).trim() === "")) return;
    const id = cellText(row[idCol]);
    if (!id) {
      errors.push(`row ${rowNumber}: missing __id`);
      return;
    }
    const existing = getTransactionById(id);
    if (!existing || existing.deleted_at != null) {
      errors.push(`row ${rowNumber} (${id}): transaction not found`);
      return;
    }
    const dateText = cellText(row[dateCol]);
    if (!isIsoDate(dateText)) {
      errors.push(`row ${rowNumber} (${id}): invalid date "${dateText}"`);
      return;
    }
    const amount = cellAmount(row[amountCol]);
    if (amount == null || !amountSchema.safeParse(amount).success) {
      errors.push(`row ${rowNumber} (${id}): invalid amount`);
      return;
    }

    const label = cellText(row[subcategoryCol]);
    const rawId = cellText(row[subcategoryIdCol]);
    let resolvedId: string | null = null;
    if (label !== "") {
      const mapped = fileLabelToId.get(label) ?? null;
      if (!mapped) {
        errors.push(`row ${rowNumber} (${id}): unknown subcategory "${label}"`);
        return;
      }
      resolvedId = mapped;
    } else if (rawId !== "") {
      resolvedId = rawId;
    }

    if (resolvedId != null && !activeSubcategories.has(resolvedId)) {
      errors.push(
        `row ${rowNumber} (${id}): subcategory_id "${resolvedId}" does not exist`,
      );
      return;
    }

    const isTransferLike =
      existing.kind === "transfer" ||
      existing.kind === "adjustment" ||
      checkTransferMatch(existing.amount, existing.account_id, existing.date) !=
        null;
    if (isTransferLike && resolvedId != null) {
      errors.push(
        `row ${rowNumber} (${id}): transfer must have subcategory_id null`,
      );
      return;
    }

    if (
      resolvedId != null &&
      (existing.kind === "income" || existing.kind === "expense")
    ) {
      const sub = activeSubcategories.get(resolvedId);
      const category = sub ? categories.get(sub.category_id) : undefined;
      if (category && category.type !== existing.kind) {
        errors.push(
          `row ${rowNumber} (${id}): ${existing.kind} transaction requires a ${existing.kind} subcategory`,
        );
        return;
      }
    }

    if ((existing.subcategory_id ?? null) === resolvedId) return;
    const oldLabel =
      existing.subcategory_id != null &&
      existing.category_name != null &&
      existing.subcategory_name != null
        ? `${existing.category_name} > ${existing.subcategory_name}`
        : "Unassigned";
    pending.push({
      rowNumber,
      id,
      name: existing.name,
      oldLabel,
      newLabel: label === "" ? "Unassigned" : label,
      newSubcategoryId: resolvedId,
    });
  });

  if (errors.length > 0) {
    for (const message of errors) console.error(message);
    console.error(`Applied 0 rows (${errors.length} invalid)`);
    throw new Error("Invalid categorize rows; applied zero rows");
  }

  return pending;
}

export function applyCategorizeUpdates(
  pending: PendingUpdate[],
  dryRun: boolean,
): { updated: number; stillNeeding: string[] } {
  if (dryRun) {
    for (const update of pending) {
      console.log(
        `${update.id} "${update.name}": ${update.oldLabel} -> ${update.newLabel}`,
      );
    }
    const stillNeeding = pending
      .filter((u) => u.newSubcategoryId == null)
      .map((u) => u.id);
    console.log(
      `Dry run: ${pending.length} would update, ${stillNeeding.length} still needing category`,
    );
    return { updated: 0, stillNeeding };
  }

  const groups = new Map<string, string[]>();
  for (const update of pending) {
    const key = update.newSubcategoryId ?? "";
    const group = groups.get(key);
    if (group) group.push(update.id);
    else groups.set(key, [update.id]);
  }
  const db = getDb();
  const applyAll = db.transaction(() => {
    for (const [key, ids] of groups) {
      // A person chose these labels in the review sheet.
      bulkUpdateTransactions(ids, {
        subcategory_id: key === "" ? null : key,
        ai_suggested: false,
      });
    }
  });
  applyAll();

  const stillNeeding = pending
    .filter((u) => u.newSubcategoryId == null)
    .map((u) => u.id);
  console.log(
    `Updated ${pending.length} rows, ${stillNeeding.length} still needing category`,
  );
  return { updated: pending.length, stillNeeding };
}

export function applyCategorizeOds(
  inputPath: string,
  dryRun: boolean,
): { updated: number; stillNeeding: string[] } {
  const parsed = parseCategorizeWorkbook(inputPath);
  const pending = validateCategorizeRows(parsed);
  return applyCategorizeUpdates(pending, dryRun);
}

async function main(): Promise<void> {
  const parsed = parseApplyArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(applyUsage());
    process.exitCode = 2;
    return;
  }
  try {
    applyCategorizeOds(parsed.input, parsed.dryRun);
  } catch (error) {
    if (error instanceof Error && error.message !== "Invalid categorize rows; applied zero rows") {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
