export interface CellCoord {
  row: number;
  col: number;
}

export interface CellRange {
  start: CellCoord;
  end: CellCoord;
}

export interface NormalizedCellRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export function normalizeRange(range: CellRange): NormalizedCellRange {
  return {
    startRow: Math.min(range.start.row, range.end.row),
    endRow: Math.max(range.start.row, range.end.row),
    startCol: Math.min(range.start.col, range.end.col),
    endCol: Math.max(range.start.col, range.end.col),
  };
}

export function isCellInRanges(
  cell: CellCoord,
  ranges: readonly CellRange[],
): boolean {
  return ranges.some((range) => {
    const normalized = normalizeRange(range);
    return (
      cell.row >= normalized.startRow &&
      cell.row <= normalized.endRow &&
      cell.col >= normalized.startCol &&
      cell.col <= normalized.endCol
    );
  });
}

export function selectionBoundingRange(
  ranges: readonly CellRange[],
): NormalizedCellRange | null {
  if (ranges.length === 0) return null;

  const normalizedRanges = ranges.map(normalizeRange);
  return {
    startRow: Math.min(...normalizedRanges.map((range) => range.startRow)),
    endRow: Math.max(...normalizedRanges.map((range) => range.endRow)),
    startCol: Math.min(...normalizedRanges.map((range) => range.startCol)),
    endCol: Math.max(...normalizedRanges.map((range) => range.endCol)),
  };
}

export function parseClipboardMatrix(text: string): string[][] {
  const rows = text.split(/\r?\n/);
  if (rows.length > 1 && rows[rows.length - 1] === "") {
    rows.pop();
  }
  return rows.map((row) => row.split("\t"));
}

export function formatClipboardMatrix(
  matrix: readonly (readonly string[])[],
): string {
  return matrix.map((row) => row.join("\t")).join("\n");
}

export function rectangleFrom(anchor: CellCoord, focus: CellCoord): CellRange {
  return { start: anchor, end: focus };
}
