// Shared helpers for the flat-ODS (.fods) round-trip spreadsheets written by
// the *:export scripts and read back by the *:apply scripts.
import { readFileSync } from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function stringCell(value: string, validationName?: string): string {
  const validation =
    validationName != null
      ? ` table:content-validation-name="${validationName}"`
      : "";
  if (value === "") return `<table:table-cell${validation}/>`;
  return `<table:table-cell office:value-type="string"${validation}><text:p>${escapeXml(value)}</text:p></table:table-cell>`;
}

export function floatCell(value: number): string {
  return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${escapeXml(String(value))}</text:p></table:table-cell>`;
}

export function fodsRow(cells: string[]): string {
  return `<table:table-row>${cells.join("")}</table:table-row>`;
}

export function headerRow(header: readonly string[]): string {
  return fodsRow(header.map((h) => stringCell(h)));
}

interface FodsTable {
  name: string;
  /** One entry per column; `true` hides it (the `__` id columns). */
  hiddenColumns: boolean[];
  rows: string[];
}

// Freezes the header row of each sheet when opened in LibreOffice.
function frozenHeaderSettings(name: string): string {
  return `<config:config-item-map-entry config:name="${escapeXml(name)}"><config:config-item config:name="CursorPositionX" config:type="int">0</config:config-item><config:config-item config:name="CursorPositionY" config:type="int">0</config:config-item><config:config-item config:name="ActiveSplitRange" config:type="short">2</config:config-item><config:config-item config:name="HorizontalSplitMode" config:type="short">2</config:config-item><config:config-item config:name="VerticalSplitMode" config:type="short">0</config:config-item><config:config-item config:name="HorizontalSplitPosition" config:type="int">1</config:config-item><config:config-item config:name="VerticalSplitPosition" config:type="int">0</config:config-item><config:config-item config:name="PositionLeft" config:type="int">0</config:config-item><config:config-item config:name="PositionRight" config:type="int">1</config:config-item><config:config-item config:name="PositionTop" config:type="int">1</config:config-item><config:config-item config:name="PositionBottom" config:type="int">1</config:config-item><config:config-item config:name="ZoomType" config:type="short">0</config:config-item><config:config-item config:name="ZoomValue" config:type="int">100</config:config-item><config:config-item config:name="ShowGrid" config:type="boolean">true</config:config-item></config:config-item-map-entry>`;
}

export function fodsDocument(
  tables: FodsTable[],
  options: { activeTable: string; validations?: string },
): string {
  const settings = tables.map((table) => frozenHeaderSettings(table.name)).join("");
  const body = tables
    .map((table) => {
      const columns = table.hiddenColumns
        .map((hidden) =>
          hidden ? `<table:table-column table:style-name="co-hidden"/>` : "<table:table-column/>",
        )
        .join("");
      return `<table:table table:name="${escapeXml(table.name)}">
${columns}
${table.rows.join("\n")}
</table:table>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry><config:config-item-map-named config:name="Tables">${settings}</config:config-item-map-named><config:config-item config:name="ActiveTable" config:type="string">${escapeXml(options.activeTable)}</config:config-item></config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings>
<office:automatic-styles><style:style style:name="co-hidden" style:family="table-column"><style:table-column-properties table:visibility="collapse"/></style:style></office:automatic-styles>
<office:body><office:spreadsheet>
<table:calculation-settings table:automatic-find-labels="false" table:use-regular-expressions="false" table:use-wildcards="true"/>
${options.validations ?? ""}
${body}
</office:spreadsheet></office:body></office:document>
`;
}

// ---------- Reading edited files ----------

export function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).trim();
}

export function cellAmount(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => cell == null || String(cell).trim() === "");
}

// LibreOffice occasionally saves truncated XML after a crash; reading it would
// silently drop rows, so refuse the whole file instead.
function assertFodsCellBalance(xml: string): void {
  const opens = xml.match(/<table:table-cell(\s[^>]*[^/])?>/g) ?? [];
  const closes = xml.match(/<\/table:table-cell>/g) ?? [];
  if (opens.length !== closes.length) {
    throw new Error(
      `Malformed spreadsheet XML: ${opens.length} table cells opened but ${closes.length} closed; applied zero rows`,
    );
  }
}

export function readWorkbook(inputPath: string): { resolved: string; workbook: XLSX.WorkBook } {
  const resolved = path.resolve(inputPath);
  if (resolved.toLowerCase().endsWith(".fods")) {
    assertFodsCellBalance(readFileSync(resolved, "utf8"));
  }
  try {
    return { resolved, workbook: XLSX.readFile(resolved) };
  } catch (cause) {
    throw new Error(`Cannot read spreadsheet: ${resolved} :: ${String(cause)}`);
  }
}

export function findSheet(workbook: XLSX.WorkBook, name: string): XLSX.WorkSheet | null {
  const found = workbook.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase());
  return found ? (workbook.Sheets[found] ?? null) : null;
}

export function gridOf(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
}
