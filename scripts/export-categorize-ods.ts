import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db/index.js";
import {
  getCategories,
  getSubcategories,
} from "../server/services/categories.js";
import {
  getRecentTransactionByNameAndAccount,
  getTransactionsWithDetails,
} from "../server/services/transactions/read.js";

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
      const recent = getRecentTransactionByNameAndAccount(t.name, t.account_id);
      const matchLabel = labelForSubcategory(
        recent?.subcategory_id ?? null,
        byId,
      );
      if (matchLabel && recent?.subcategory_id) {
        suggestion = matchLabel;
        subcategory = matchLabel;
        subcategoryId = recent.subcategory_id;
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

const REVIEW_HEADER = [
  "__id",
  "date",
  "name",
  "amount",
  "account",
  "ai_suggestion",
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
    `<table:table-row>${REVIEW_HEADER.map((h) => stringCell(h)).join("")}</table:table-row>`,
    ...rows.map(
      (r) =>
        `<table:table-row>${stringCell(r.id)}${stringCell(r.date)}${stringCell(r.name)}${floatCell(r.amount)}${stringCell(r.account)}${stringCell(r.suggestion)}${stringCell(r.subcategory, hasValidation ? validationName : undefined)}${stringCell(r.comment)}${stringCell(r.subcategoryId)}</table:table-row>`,
    ),
  ].join("\n");

  const choiceRows = [
    `<table:table-row>${stringCell("label")}${stringCell("id")}</table:table-row>`,
    ...choices.map(
      (c) =>
        `<table:table-row>${stringCell(c.label)}${stringCell(c.id)}</table:table-row>`,
    ),
  ].join("\n");

  const validation = hasValidation
    ? `<table:content-validations><table:content-validation table:name="${validationName}" table:condition="of:cell-content-is-in-list([$Choices.$A$2:.$A$${lastChoiceRow}])" table:allow-empty-cell="true" table:display-list="unsorted" table:base-cell-address="Review.G2"/></table:content-validations>`
    : "";

  const splitEntry = (name: string): string =>
    `<config:config-item-map-entry config:name="${escapeXml(name)}"><config:config-item config:name="CursorPositionX" config:type="int">0</config:config-item><config:config-item config:name="CursorPositionY" config:type="int">0</config:config-item><config:config-item config:name="ActiveSplitRange" config:type="short">2</config:config-item><config:config-item config:name="HorizontalSplitMode" config:type="short">2</config:config-item><config:config-item config:name="VerticalSplitMode" config:type="short">0</config:config-item><config:config-item config:name="HorizontalSplitPosition" config:type="int">1</config:config-item><config:config-item config:name="VerticalSplitPosition" config:type="int">0</config:config-item><config:config-item config:name="PositionLeft" config:type="int">0</config:config-item><config:config-item config:name="PositionRight" config:type="int">1</config:config-item><config:config-item config:name="PositionTop" config:type="int">1</config:config-item><config:config-item config:name="PositionBottom" config:type="int">1</config:config-item><config:config-item config:name="ZoomType" config:type="short">0</config:config-item><config:config-item config:name="ZoomValue" config:type="int">100</config:config-item><config:config-item config:name="ShowGrid" config:type="boolean">true</config:config-item></config:config-item-map-entry>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry><config:config-item-map-named config:name="Tables">${splitEntry("Review")}${splitEntry("Choices")}</config:config-item-map-named><config:config-item config:name="ActiveTable" config:type="string">Review</config:config-item></config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings>
<office:automatic-styles><style:style style:name="co-hidden" style:family="table-column"><style:table-column-properties table:visibility="collapse"/></style:style></office:automatic-styles>
<office:body><office:spreadsheet>
<table:calculation-settings table:automatic-find-labels="false" table:use-regular-expressions="false" table:use-wildcards="true"/>
${validation}
<table:table table:name="Review">
<table:table-column table:style-name="co-hidden"/><table:table-column/><table:table-column/><table:table-column/><table:table-column/><table:table-column/><table:table-column/><table:table-column/><table:table-column table:style-name="co-hidden"/>
${reviewRows}
</table:table>
<table:table table:name="Choices">
<table:table-column/><table:table-column/>
${choiceRows}
</table:table>
</office:spreadsheet></office:body></office:document>
`;
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
  return "Usage: categorize:export <out.fods> [--needs-category-only] [--limit N]";
}

export function parseExportArgs(argv: string[]): {
  options: ExportCategorizeOptions;
} | null {
  const positional: string[] = [];
  let needsCategoryOnly = false;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--needs-category-only") needsCategoryOnly = true;
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
  const out = positional[0] ?? "categorize-review.fods";
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
