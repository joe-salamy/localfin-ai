import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db/index.js";
import {
  getCategories,
  getSubcategories,
} from "../server/services/categories.js";
import { localIsoDate } from "../server/services/dates.js";
import type { Category, Subcategory } from "../shared/contracts/index.js";
import { DOWNLOADS_DIRECTORY } from "./user-paths.js";
import { fodsDocument, fodsRow, floatCell, headerRow, stringCell } from "./ods-common.js";

export interface TaxonomyExportOptions {
  out: string;
}

export const TAXONOMY_META_HEADER = ["key", "value"] as const;
export const TAXONOMY_CATEGORY_HEADER = [
  "__id",
  "name",
  "type",
  "color",
  "__delete",
] as const;
export const TAXONOMY_SUBCATEGORY_HEADER = [
  "__id",
  "name",
  "category",
  "__category_id",
  "monthly_goal",
  "color",
  "__delete",
] as const;
export function computeTaxonomyFingerprint(
  categories: Category[],
  subcategories: Subcategory[],
): string {
  const parts: string[] = [];
  for (const c of categories) parts.push(`${c.id}:${c.updated_at ?? ""}`);
  for (const s of subcategories) parts.push(`${s.id}:${s.updated_at ?? ""}`);
  parts.sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export function buildTaxonomyFods(args: {
  categories: Category[];
  subcategories: Subcategory[];
  fingerprint: string;
  createdAt: string;
}): string {
  const { categories, subcategories, fingerprint, createdAt } = args;

  const sortedCategories = [...categories].sort((a, b) =>
    a.type === b.type
      ? a.name.localeCompare(b.name)
      : a.type.localeCompare(b.type),
  );
  const categoryNameById = new Map(
    categories.map((c) => [c.id, c.name] as const),
  );
  const sortedSubcategories = [...subcategories].sort((a, b) => {
    const ca = categoryNameById.get(a.category_id) ?? "?";
    const cb = categoryNameById.get(b.category_id) ?? "?";
    return ca === cb
      ? a.name.localeCompare(b.name)
      : ca.localeCompare(cb);
  });
  const metaRows = [
    headerRow(TAXONOMY_META_HEADER),
    ...[
      ["purpose", "taxonomy"],
      ["created_at", createdAt],
      ["fingerprint", fingerprint],
      ["categories", String(sortedCategories.length)],
      ["subcategories", String(sortedSubcategories.length)],
    ].map(([key, value]) => fodsRow([stringCell(key), stringCell(value)])),
  ];

  const categoryRows = [
    headerRow(TAXONOMY_CATEGORY_HEADER),
    ...sortedCategories.map((c) =>
      fodsRow([
        stringCell(c.id),
        stringCell(c.name),
        stringCell(c.type, "CategoryType"),
        stringCell(c.color ?? ""),
        stringCell(""),
      ]),
    ),
  ];

  const subcategoryRows = [
    headerRow(TAXONOMY_SUBCATEGORY_HEADER),
    ...sortedSubcategories.map((s) =>
      fodsRow([
        stringCell(s.id),
        stringCell(s.name),
        stringCell(categoryNameById.get(s.category_id) ?? "?"),
        stringCell(s.category_id),
        s.monthly_goal == null ? stringCell("") : floatCell(s.monthly_goal),
        stringCell(s.color ?? ""),
        stringCell(""),
      ]),
    ),
  ];

  const validations = `<table:content-validations><table:content-validation table:name="CategoryType" table:condition="of:cell-content-is-in-list(&quot;income&quot;;&quot;expense&quot;)" table:allow-empty-cell="true" table:display-list="unsorted" table:base-cell-address="Categories.C2"/></table:content-validations>`;
  const hidden = (header: readonly string[]) => header.map((h) => h.startsWith("__"));

  return fodsDocument(
    [
      { name: "_meta", hiddenColumns: [false, false], rows: metaRows },
      { name: "Categories", hiddenColumns: hidden(TAXONOMY_CATEGORY_HEADER), rows: categoryRows },
      { name: "Subcategories", hiddenColumns: hidden(TAXONOMY_SUBCATEGORY_HEADER), rows: subcategoryRows },
    ],
    { activeTable: "Categories", validations },
  );
}

export function taxonomyExportUsage(): string {
  return "Usage: taxonomy:export [out.fods] (default out: ~/Downloads/taxonomy-review.fods)";
}

export function parseTaxonomyExportArgs(
  argv: string[],
): { options: TaxonomyExportOptions } | null {
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return null;
    else if (arg.startsWith("--")) return null;
    else positional.push(arg);
  }
  if (positional.length > 1) return null;
  const out = positional[0] ?? path.join(DOWNLOADS_DIRECTORY, "taxonomy-review.fods");
  return { options: { out } };
}

export async function exportTaxonomyOds(
  options: TaxonomyExportOptions,
): Promise<{ path: string; categories: number; subcategories: number }> {
  void getDb();
  const categories = getCategories();
  const subcategories = getSubcategories();
  const fingerprint = computeTaxonomyFingerprint(categories, subcategories);
  const createdAt = new Date().toISOString();
  const outputPath = path.resolve(options.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    buildTaxonomyFods({
      categories,
      subcategories,
      fingerprint,
      createdAt,
    }),
    "utf8",
  );
  const now = new Date();
  const line = `${JSON.stringify({
    timestamp: now.toISOString(),
    operation: "taxonomy.export",
    output_path: outputPath,
    fingerprint,
    categories: categories.length,
    subcategories: subcategories.length,
    result: "exported",
  })}\n`;
  const logPath = path.resolve(
    "logs",
    "jsonl",
    `ods-${localIsoDate(now)}.jsonl`,
  );
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, line, "utf8");
  return {
    path: outputPath,
    categories: categories.length,
    subcategories: subcategories.length,
  };
}

async function main(): Promise<void> {
  const parsed = parseTaxonomyExportArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(taxonomyExportUsage());
    process.exitCode = 2;
    return;
  }
  try {
    const result = await exportTaxonomyOds(parsed.options);
    console.log(
      `Wrote ${result.path} (${result.categories} categories, ${result.subcategories} subcategories)`,
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
