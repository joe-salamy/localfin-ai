import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db/index.js";
import {
  getCategories,
  getSubcategories,
} from "../server/services/categories.js";
import { createCategoryLookup } from "../server/services/transactions/lookup.js";
import { getTransactionsWithDetails } from "../server/services/transactions/read.js";
import { INBOX_DIRECTORY } from "./exchange-paths.js";
import { escapeXml, fodsDocument, fodsRow, floatCell, headerRow, stringCell } from "./ods-common.js";

export interface CategorizeChoice {
  id: string;
  label: string;
}

export interface CategorizeRow {
  id: string;
  date: string;
  name: string;
  amount: number;
  account: string;
  suggestion: string;
  subcategory: string;
  comment: string;
  subcategoryId: string;
}

export interface ExportCategorizeOptions {
  out: string;
  needsCategoryOnly: boolean;
  limit: number | null;
  ids?: string[];
}

export function loadCategorizeChoices(): CategorizeChoice[] {
  void getDb();
  const categories = new Map(
    getCategories().map((c) => [c.id, c] as const),
  );
  return getSubcategories()
    .filter((s) => categories.has(s.category_id))
    .map((s) => ({
      id: s.id,
      label: `${categories.get(s.category_id)?.name ?? "?"} > ${s.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSubcategory(
  subcategoryId: string | null,
  byId: Map<string, string>,
): string {
  if (!subcategoryId) return "";
  return byId.get(subcategoryId) ?? "";
}

export function collectCategorizeRows(
  needsCategoryOnly: boolean,
  limit: number | null,
  ids?: string[],
): CategorizeRow[] {
  void getDb();
  const choices = loadCategorizeChoices();
  const byId = new Map(choices.map((c) => [c.id, c.label] as const));
  const lookupCategory = createCategoryLookup();
  const idFilter = ids != null ? new Set(ids) : null;

  let rows = getTransactionsWithDetails(
    needsCategoryOnly ? { needsCategory: true } : {},
  ).filter((t) => !t.is_initial_balance && t.deleted_at == null);
  if (idFilter) rows = rows.filter((t) => idFilter.has(t.id));
  rows = [...rows].sort((a, b) =>
    a.date === b.date
      ? a.created_at.localeCompare(b.created_at)
      : a.date.localeCompare(b.date),
  );
  if (limit != null) rows = rows.slice(0, limit);

  return rows.map((t) => {
    const current = labelForSubcategory(t.subcategory_id, byId);
    let suggestion = current;
    let subcategory = current;
    let subcategoryId = t.subcategory_id ?? "";
    if (!current) {
      const hit = lookupCategory(t.name, t.account_id, t.kind);
      const matchLabel = labelForSubcategory(hit?.subcategoryId ?? null, byId);
      if (hit && matchLabel) {
        suggestion = matchLabel;
        subcategory = matchLabel;
        subcategoryId = hit.subcategoryId;
      }
    }
    return {
      id: t.id,
      date: t.date,
      name: t.name,
      amount: t.amount,
      account: t.account_name ?? t.account_id,
      suggestion,
      subcategory,
      comment: t.comment ?? "",
      subcategoryId,
    };
  });
}

export const REVIEW_HEADER = [
  "__id",
  "date",
  "name",
  "amount",
  "account",
  "suggestion",
  "subcategory",
  "comment",
  "__subcategory_id",
] as const;

export function buildCategorizeFods(
  rows: CategorizeRow[],
  choices: CategorizeChoice[],
): string {
  const choiceCount = choices.length;
  const lastChoiceRow = choiceCount + 1;
  const hasValidation = choiceCount > 0;
  const validationName = "SubcategoryChoice";

  const reviewRows = [
    headerRow(REVIEW_HEADER),
    ...rows.map((r) =>
      fodsRow([
        stringCell(r.id),
        stringCell(r.date),
        stringCell(r.name),
        floatCell(r.amount),
        stringCell(r.account),
        stringCell(r.suggestion),
        stringCell(r.subcategory, hasValidation ? validationName : undefined),
        stringCell(r.comment),
        stringCell(r.subcategoryId),
      ]),
    ),
  ];
  const choiceRows = [
    headerRow(["label", "id"]),
    ...choices.map((c) => fodsRow([stringCell(c.label), stringCell(c.id)])),
  ];

  const validations = hasValidation
    ? `<table:content-validations><table:content-validation table:name="${escapeXml(validationName)}" table:condition="of:cell-content-is-in-list([$Choices.$A$2:.$A$${lastChoiceRow}])" table:allow-empty-cell="true" table:display-list="unsorted" table:base-cell-address="Review.G2"/></table:content-validations>`
    : "";

  return fodsDocument(
    [
      {
        name: "Review",
        hiddenColumns: REVIEW_HEADER.map((h) => h.startsWith("__")),
        rows: reviewRows,
      },
      { name: "Choices", hiddenColumns: [false, false], rows: choiceRows },
    ],
    { activeTable: "Review", validations },
  );
}

export async function exportCategorizeOds(
  options: ExportCategorizeOptions,
): Promise<{ path: string; exported: number; choices: number }> {
  const choices = loadCategorizeChoices();
  const rows = collectCategorizeRows(
    options.needsCategoryOnly,
    options.limit,
    options.ids,
  );
  const outputPath = path.resolve(options.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buildCategorizeFods(rows, choices), "utf8");
  return { path: outputPath, exported: rows.length, choices: choices.length };
}

export function exportUsage(): string {
  return "Usage: categorize:export [out.fods] [--all] [--limit N] (default: rows needing a category; out: ~/Documents/LocalFin/inbox/categorize-review.fods)";
}

export function parseExportArgs(argv: string[]): {
  options: ExportCategorizeOptions;
} | null {
  const positional: string[] = [];
  let needsCategoryOnly = true;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") needsCategoryOnly = false;
    else if (arg === "--limit") {
      const raw = argv[i + 1];
      i += 1;
      if (raw == null || !/^\d+$/.test(raw) || Number(raw) <= 0) return null;
      limit = Number(raw);
    } else if (arg === "--help" || arg === "-h") {
      return null;
    } else if (arg.startsWith("--")) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  const out = positional[0] ?? path.join(INBOX_DIRECTORY, "categorize-review.fods");
  return { options: { out, needsCategoryOnly, limit } };
}

async function main(): Promise<void> {
  const parsed = parseExportArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(exportUsage());
    process.exitCode = 2;
    return;
  }
  try {
    const result = await exportCategorizeOds(parsed.options);
    console.log(
      `Wrote ${result.path} (${result.exported} rows, ${result.choices} choices)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
