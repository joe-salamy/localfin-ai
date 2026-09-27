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
import type { Category, Subcategory } from "../shared/contracts/index.js";

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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stringCell(value: string, validationName?: string): string {
  const validation =
    validationName != null
      ? ` table:content-validation-name="${validationName}"`
      : "";
  if (value === "") return `<table:table-cell${validation}/>`;
  return `<table:table-cell office:value-type="string"${validation}><text:p>${escapeXml(value)}</text:p></table:table-cell>`;
}

function floatCell(value: number): string {
  return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${escapeXml(String(value))}</text:p></table:table-cell>`;
}

function localDatePart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
    `<table:table-row>${stringCell("key")}${stringCell("value")}</table:table-row>`,
    `<table:table-row>${stringCell("purpose")}${stringCell("taxonomy")}</table:table-row>`,
    `<table:table-row>${stringCell("created_at")}${stringCell(createdAt)}</table:table-row>`,
    `<table:table-row>${stringCell("fingerprint")}${stringCell(fingerprint)}</table:table-row>`,
    `<table:table-row>${stringCell("categories")}${stringCell(String(sortedCategories.length))}</table:table-row>`,
    `<table:table-row>${stringCell("subcategories")}${stringCell(String(sortedSubcategories.length))}</table:table-row>`,
  ].join("\n");

  const categoryRows = [
    `<table:table-row>${TAXONOMY_CATEGORY_HEADER.map((h) => stringCell(h)).join("")}</table:table-row>`,
    ...sortedCategories.map(
      (c) =>
        `<table:table-row>${stringCell(c.id)}${stringCell(c.name)}${stringCell(c.type, "CategoryType")}${stringCell(c.color ?? "")}${stringCell("")}</table:table-row>`,
    ),
  ].join("\n");

  const subcategoryRows = [
    `<table:table-row>${TAXONOMY_SUBCATEGORY_HEADER.map((h) => stringCell(h)).join("")}</table:table-row>`,
    ...sortedSubcategories.map((s) => {
      const categoryName = categoryNameById.get(s.category_id) ?? "?";
      const goalCell =
        s.monthly_goal == null
          ? stringCell("")
          : floatCell(s.monthly_goal);
      return `<table:table-row>${stringCell(s.id)}${stringCell(s.name)}${stringCell(categoryName)}${stringCell(s.category_id)}${goalCell}${stringCell(s.color ?? "")}${stringCell("")}</table:table-row>`;
    }),
  ].join("\n");

  const validation = `<table:content-validations><table:content-validation table:name="CategoryType" table:condition="of:cell-content-is-in-list(&quot;income&quot;;&quot;expense&quot;)" table:allow-empty-cell="true" table:display-list="unsorted" table:base-cell-address="Categories.C2"/></table:content-validations>`;

  const splitEntry = (name: string): string =>
    `<config:config-item-map-entry config:name="${escapeXml(name)}"><config:config-item config:name="CursorPositionX" config:type="int">0</config:config-item><config:config-item config:name="CursorPositionY" config:type="int">0</config:config-item><config:config-item config:name="ActiveSplitRange" config:type="short">2</config:config-item><config:config-item config:name="HorizontalSplitMode" config:type="short">2</config:config-item><config:config-item config:name="VerticalSplitMode" config:type="short">0</config:config-item><config:config-item config:name="HorizontalSplitPosition" config:type="int">1</config:config-item><config:config-item config:name="VerticalSplitPosition" config:type="int">0</config:config-item><config:config-item config:name="PositionLeft" config:type="int">0</config:config-item><config:config-item config:name="PositionRight" config:type="int">1</config:config-item><config:config-item config:name="PositionTop" config:type="int">1</config:config-item><config:config-item config:name="PositionBottom" config:type="int">1</config:config-item><config:config-item config:name="ZoomType" config:type="short">0</config:config-item><config:config-item config:name="ZoomValue" config:type="int">100</config:config-item><config:config-item config:name="ShowGrid" config:type="boolean">true</config:config-item></config:config-item-map-entry>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry><config:config-item-map-named config:name="Tables">${splitEntry("_meta")}${splitEntry("Categories")}${splitEntry("Subcategories")}</config:config-item-map-named><config:config-item config:name="ActiveTable" config:type="string">Categories</config:config-item></config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings>
<office:automatic-styles><style:style style:name="co-hidden" style:family="table-column"><style:table-column-properties table:visibility="collapse"/></style:style></office:automatic-styles>
<office:body><office:spreadsheet>
<table:calculation-settings table:automatic-find-labels="false" table:use-regular-expressions="false" table:use-wildcards="true"/>
${validation}
<table:table table:name="_meta">
<table:table-column/><table:table-column/>
${metaRows}
</table:table>
<table:table table:name="Categories">
<table:table-column table:style-name="co-hidden"/><table:table-column/><table:table-column/><table:table-column/><table:table-column table:style-name="co-hidden"/>
${categoryRows}
</table:table>
<table:table table:name="Subcategories">
<table:table-column table:style-name="co-hidden"/><table:table-column/><table:table-column/><table:table-column table:style-name="co-hidden"/><table:table-column/><table:table-column/><table:table-column table:style-name="co-hidden"/>
${subcategoryRows}
</table:table>
</office:spreadsheet></office:body></office:document>
`;
}

export function taxonomyExportUsage(): string {
  return "Usage: taxonomy:export [out.fods] (default out: ./taxonomy-review.fods)";
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
  const out = positional[0] ?? "taxonomy-review.fods";
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
    `ods-${localDatePart(now)}.jsonl`,
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
