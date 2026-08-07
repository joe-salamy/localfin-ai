export interface CellCoord {
  row: number;
  col: number;
}

export interface CellRange {
  start: CellCoord;
  end: CellCoord;
}

export type SpreadsheetArrowKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

export function isSpreadsheetArrowKey(
  key: string,
): key is SpreadsheetArrowKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight"
  );
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

export function expandRangesToCells(
  ranges: readonly CellRange[],
  rowCount: number,
  colCount: number,
): CellCoord[] {
  if (rowCount <= 0 || colCount <= 0 || ranges.length === 0) return [];

  const cells: CellCoord[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      const cell = { row, col };
      if (isCellInRanges(cell, ranges)) cells.push(cell);
    }
  }
  return cells;
}

export function topLeftCell(cells: readonly CellCoord[]): CellCoord | null {
  if (cells.length === 0) return null;
  return cells.reduce((best, cell) =>
    cell.row < best.row || (cell.row === best.row && cell.col < best.col)
      ? cell
      : best,
  );
}

export function isSingleCellMatrix(
  matrix: readonly (readonly string[])[],
): boolean {
  return matrix.length === 1 && (matrix[0]?.length ?? 0) === 1;
}

export function moveCellWithinBounds(
  cell: CellCoord,
  key: SpreadsheetArrowKey,
  rowCount: number,
  colCount: number,
): CellCoord | null {
  if (rowCount <= 0 || colCount <= 0) return null;

  const row = Math.min(rowCount - 1, Math.max(0, cell.row));
  const col = Math.min(colCount - 1, Math.max(0, cell.col));
  if (key === "ArrowLeft") {
    return { row, col: Math.max(0, col - 1) };
  }
  if (key === "ArrowRight") {
    return { row, col: Math.min(colCount - 1, col + 1) };
  }
  if (key === "ArrowUp") {
    return { row: Math.max(0, row - 1), col };
  }
  return { row: Math.min(rowCount - 1, row + 1), col };
}

export function buildClipboardMatrix(
  ranges: readonly CellRange[],
  readCell: (cell: CellCoord) => string,
): string[][] | null {
  const bounds = selectionBoundingRange(ranges);
  if (!bounds) return null;

  const matrix: string[][] = [];
  for (let row = bounds.startRow; row <= bounds.endRow; row++) {
    const values: string[] = [];
    for (let col = bounds.startCol; col <= bounds.endCol; col++) {
      const cell = { row, col };
      values.push(isCellInRanges(cell, ranges) ? readCell(cell) : "");
    }
    matrix.push(values);
  }
  return matrix;
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
