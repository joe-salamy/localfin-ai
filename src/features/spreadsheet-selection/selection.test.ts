/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
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
  assert.deepEqual(
    normalizeRange({ start: { row: 3, col: 4 }, end: { row: 1, col: 2 } }),
    { startRow: 1, endRow: 3, startCol: 2, endCol: 4 },
  );
});

test("shift range math uses anchor and focus rectangle", () => {
  const range = rectangleFrom({ row: 0, col: 0 }, { row: 2, col: 3 });

  assert.deepEqual(normalizeRange(range), {
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

  assert.equal(isCellInRanges({ row: 1, col: 1 }, ranges), true);
  assert.equal(isCellInRanges({ row: 3, col: 3 }, ranges), true);
  assert.equal(isCellInRanges({ row: 2, col: 2 }, ranges), false);
});

test("expands a rectangular range into row-major cells", () => {
  assert.deepEqual(
    expandRangesToCells([rectangleFrom({ row: 1, col: 2 }, { row: 2, col: 3 })], 4, 5),
    [
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
    ],
  );
});

test("expands discontiguous ranges without filling holes between them", () => {
  assert.deepEqual(
    expandRangesToCells(
      [
        rectangleFrom({ row: 0, col: 1 }, { row: 0, col: 1 }),
        rectangleFrom({ row: 2, col: 3 }, { row: 2, col: 3 }),
      ],
      4,
      5,
    ),
    [
      { row: 0, col: 1 },
      { row: 2, col: 3 },
    ],
  );
});

test("expands ranges only within non-empty sheet bounds", () => {
  const ranges = [rectangleFrom({ row: -1, col: -1 }, { row: 1, col: 1 })];

  assert.deepEqual(expandRangesToCells(ranges, 2, 2), [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
  ]);
  assert.deepEqual(expandRangesToCells(ranges, 0, 2), []);
  assert.deepEqual(expandRangesToCells(ranges, 2, 0), []);
});

test("finds the top-left cell by row then column", () => {
  assert.deepEqual(
    topLeftCell([
      { row: 2, col: 3 },
      { row: 1, col: 8 },
      { row: 1, col: 2 },
    ]),
    { row: 1, col: 2 },
  );
});

test("detects matrices that contain exactly one cell", () => {
  assert.equal(isSingleCellMatrix([["Coffee"]]), true);
  assert.equal(isSingleCellMatrix([["Coffee", "Tea"]]), false);
  assert.equal(isSingleCellMatrix([["Coffee"], ["Tea"]]), false);
});

test("moves cells within sheet bounds", () => {
  assert.deepEqual(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowLeft", 2, 2), {
    row: 0,
    col: 0,
  });
  assert.deepEqual(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowUp", 2, 2), {
    row: 0,
    col: 0,
  });
  assert.deepEqual(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowRight", 2, 2), {
    row: 0,
    col: 1,
  });
  assert.deepEqual(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowDown", 2, 2), {
    row: 1,
    col: 0,
  });
  assert.equal(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowRight", 0, 2), null);
  assert.equal(moveCellWithinBounds({ row: 0, col: 0 }, "ArrowDown", 2, 0), null);
});

test("computes bounding rectangle around multiple ranges", () => {
  const ranges = [
    rectangleFrom({ row: 4, col: 2 }, { row: 4, col: 5 }),
    rectangleFrom({ row: 1, col: 7 }, { row: 2, col: 8 }),
  ];

  assert.deepEqual(selectionBoundingRange(ranges), {
    startRow: 1,
    endRow: 4,
    startCol: 2,
    endCol: 8,
  });
});

test("parses and formats TSV while preserving inner empty cells", () => {
  const matrix = parseClipboardMatrix("a\t\tc\n1\t2\t");

  assert.deepEqual(matrix, [
    ["a", "", "c"],
    ["1", "2", ""],
  ]);
  assert.equal(formatClipboardMatrix(matrix), "a\t\tc\n1\t2\t");
});

test("drops one final blank row caused by terminal newline", () => {
  assert.deepEqual(parseClipboardMatrix("a\tb\n"), [["a", "b"]]);
  assert.deepEqual(parseClipboardMatrix("a\tb\n\n"), [["a", "b"], [""]]);
});
