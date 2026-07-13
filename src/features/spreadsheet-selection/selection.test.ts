import { expect, test } from "vitest"
import {
  expandRangesToCells,
  formatClipboardMatrix,
  isCellInRanges,
  isSingleCellMatrix,
  moveCellWithinBounds,
  normalizeRange,
  parseClipboardMatrix,
  rectangleFrom,
  selectionBoundingRange,
  topLeftCell,
} from "./selection";

test("normalizes rectangular selections regardless of drag direction", () => {
  expect(normalizeRange({ start: { row: 3, col: 4 }, end: { row: 1, col: 2 } })).toEqual({ startRow: 1, endRow: 3, startCol: 2, endCol: 4 });
});

test("shift range math uses anchor and focus rectangle", () => {
  const range = rectangleFrom({ row: 0, col: 0 }, { row: 2, col: 3 });

  expect(normalizeRange(range)).toEqual({
    startRow: 0,
    endRow: 2,
    startCol: 0,
    endCol: 3,
  });
});

test("ctrl or cmd discontiguous ranges include selected cells only", () => {
  const ranges = [
    rectangleFrom({ row: 0, col: 0 }, { row: 1, col: 1 }),
    rectangleFrom({ row: 3, col: 3 }, { row: 3, col: 3 }),
  ];

  expect(isCellInRanges({ row: 1, col: 1 }, ranges)).toBe(true);
  expect(isCellInRanges({ row: 3, col: 3 }, ranges)).toBe(true);
  expect(isCellInRanges({ row: 2, col: 2 }, ranges)).toBe(false);
});

test("expands a rectangular range into row-major cells", () => {
  expect(expandRangesToCells([rectangleFrom({ row: 1, col: 2 }, { row: 2, col: 3 })], 4, 5)).toEqual([
    { row: 1, col: 2 },
    { row: 1, col: 3 },
    { row: 2, col: 2 },
    { row: 2, col: 3 },
  ]);
});

test("expands discontiguous ranges without filling holes between them", () => {
  expect(expandRangesToCells(
    [
      rectangleFrom({ row: 0, col: 1 }, { row: 0, col: 1 }),
      rectangleFrom({ row: 2, col: 3 }, { row: 2, col: 3 }),
    ],
    4,
    5,
  )).toEqual([
    { row: 0, col: 1 },
    { row: 2, col: 3 },
  ]);
});

test("expands ranges only within non-empty sheet bounds", () => {
  const ranges = [rectangleFrom({ row: -1, col: -1 }, { row: 1, col: 1 })];

  expect(expandRangesToCells(ranges, 2, 2)).toEqual([
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
  ]);
  expect(expandRangesToCells(ranges, 0, 2)).toEqual([]);
  expect(expandRangesToCells(ranges, 2, 0)).toEqual([]);
});

test("finds the top-left cell by row then column", () => {
  expect(topLeftCell([
    { row: 2, col: 3 },
    { row: 1, col: 8 },
    { row: 1, col: 2 },
  ])).toEqual({ row: 1, col: 2 });
});

test("detects matrices that contain exactly one cell", () => {
  expect(isSingleCellMatrix([["Coffee"]])).toBe(true);
  expect(isSingleCellMatrix([["Coffee", "Tea"]])).toBe(false);
  expect(isSingleCellMatrix([["Coffee"], ["Tea"]])).toBe(false);
});

test("moves cells within sheet bounds", () => {
  expect(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowLeft", 2, 2)).toEqual({
    row: 0,
    col: 0,
  });
  expect(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowUp", 2, 2)).toEqual({
    row: 0,
    col: 0,
  });
  expect(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowRight", 2, 2)).toEqual({
    row: 0,
    col: 1,
  });
  expect(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowDown", 2, 2)).toEqual({
    row: 1,
    col: 0,
  });
  expect(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowRight", 0, 2)).toBe(null);
  expect(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowDown", 2, 0)).toBe(null);
});

test("computes bounding rectangle around multiple ranges", () => {
  const ranges = [
    rectangleFrom({ row: 4, col: 2 }, { row: 4, col: 5 }),
    rectangleFrom({ row: 1, col: 7 }, { row: 2, col: 8 }),
  ];

  expect(selectionBoundingRange(ranges)).toEqual({
    startRow: 1,
    endRow: 4,
    startCol: 2,
    endCol: 8,
  });
});

test("parses and formats TSV while preserving inner empty cells", () => {
  const matrix = parseClipboardMatrix("a\t\tc\n1\t2\t");

  expect(matrix).toEqual([
    ["a", "", "c"],
    ["1", "2", ""],
  ]);
  expect(formatClipboardMatrix(matrix)).toBe("a\t\tc\n1\t2\t");
});

test("drops one final blank row caused by terminal newline", () => {
  expect(parseClipboardMatrix("a\tb\n")).toEqual([["a", "b"]]);
  expect(parseClipboardMatrix("a\tb\n\n")).toEqual([["a", "b"], [""]]);
});
