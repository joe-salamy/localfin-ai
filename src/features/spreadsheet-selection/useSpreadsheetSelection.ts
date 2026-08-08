import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import {
  expandRangesToCells,
  isCellInRanges,
  moveCellWithinBounds,
  normalizeRange,
  rectangleFrom,
  type CellCoord,
  type CellRange,
  type SpreadsheetArrowKey,
} from "./selection";
export interface UseSpreadsheetSelectionOptions {
  rowCount: number;
  columnCount: number;
  rowIdentity?: string;
  containerRef: RefObject<HTMLElement | null>;
  focusCell(cell: CellCoord): void;
  copiedHighlightMs?: number;
}

export interface SpreadsheetSelectionController {
  selectedRanges: CellRange[];
  anchorCell: CellCoord | null;
  activeCell: CellCoord | null;
  copiedRanges: CellRange[];
  selectedCells(): CellCoord[];
  selectSingle(cell: CellCoord): void;
  selectRange(start: CellCoord, end: CellCoord): void;
  toggle(cell: CellCoord): void;
  extendTo(cell: CellCoord): void;
  pointerHandlers(cell: CellCoord): {
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
    onPointerUp(): void;
    onPointerCancel(): void;
  };
  handleCellFocus(cell: CellCoord): void;
  moveActive(key: SpreadsheetArrowKey, extend: boolean): CellCoord | null;
  markCopied(): void;
  clearCopied(): void;
  clearSelection(): void;
  cellState(cell: CellCoord): {
    selected: boolean;
    active: boolean;
    copied: boolean;
  };
}

function sameCell(left: CellCoord | null, right: CellCoord): boolean {
  return left?.row === right.row && left.col === right.col;
}

function clampCellToGrid(
  cell: CellCoord | null,
  rowCount: number,
  columnCount: number,
): CellCoord | null {
  if (!cell || rowCount <= 0 || columnCount <= 0) return null;
  return {
    row: Math.min(Math.max(cell.row, 0), rowCount - 1),
    col: Math.min(Math.max(cell.col, 0), columnCount - 1),
  };
}

function clampRangesToGrid(
  ranges: readonly CellRange[],
  rowCount: number,
  columnCount: number,
): CellRange[] {
  if (rowCount <= 0 || columnCount <= 0) return [];
  return ranges.flatMap((range) => {
    const normalized = normalizeRange(range);
    const startRow = Math.max(0, normalized.startRow);
    const endRow = Math.min(rowCount - 1, normalized.endRow);
    const startCol = Math.max(0, normalized.startCol);
    const endCol = Math.min(columnCount - 1, normalized.endCol);
    if (startRow > endRow || startCol > endCol) return [];
    return [
      {
        start: { row: startRow, col: startCol },
        end: { row: endRow, col: endCol },
      },
    ];
  });
}

export function useSpreadsheetSelection({
  rowCount,
  columnCount,
  rowIdentity,
  containerRef,
  focusCell,
  copiedHighlightMs = 1200,
}: UseSpreadsheetSelectionOptions): SpreadsheetSelectionController {
  const [selectedRanges, setSelectedRanges] = useState<CellRange[]>([]);
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [copiedRanges, setCopiedRanges] = useState<CellRange[]>([]);
  const [dragSelection, setDragSelection] = useState<{
    anchor: CellCoord;
    additive: boolean;
  } | null>(null);
  const selectedRangesRef = useRef(selectedRanges);
  const copiedRangesRef = useRef(copiedRanges);
  const anchorCellRef = useRef(anchorCell);
  const activeCellRef = useRef(activeCell);

  const [appliedRowIdentity, setAppliedRowIdentity] = useState(rowIdentity);
  const previousGridSizeRef = useRef({ rowCount, columnCount });
  const dragBaseRangesRef = useRef<CellRange[]>([]);
  const pointerSelectingRef = useRef(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const programmaticFocusRef = useRef(false);
  useEffect(() => {
    selectedRangesRef.current = selectedRanges;
    copiedRangesRef.current = copiedRanges;
    anchorCellRef.current = anchorCell;
    activeCellRef.current = activeCell;
  }, [activeCell, anchorCell, copiedRanges, selectedRanges]);

  // When the underlying row identity changes (sort, filter, delete), the
  // numeric selection would silently point at different transactions. Reset
  // during render (the React-sanctioned "adjust state when props change"
  // pattern) so children never see the stale selection.
  if (appliedRowIdentity !== rowIdentity) {
    setAppliedRowIdentity(rowIdentity);
    setSelectedRanges([]);
    setCopiedRanges([]);
    setAnchorCell(null);
    setActiveCell(null);
    setDragSelection(null);
  }
  const selectSingle = useCallback((cell: CellCoord) => {
    setSelectedRanges([rectangleFrom(cell, cell)]);
    setAnchorCell(cell);
    setActiveCell(cell);
  }, []);
  const selectRange = useCallback((start: CellCoord, end: CellCoord) => {
    setSelectedRanges([rectangleFrom(start, end)]);
    setAnchorCell(start);
    setActiveCell(end);
  }, []);


  const toggle = useCallback(
    (cell: CellCoord) => {
      setSelectedRanges((current) => {
        if (!isCellInRanges(cell, current)) {
          return [...current, rectangleFrom(cell, cell)];
        }
        return expandRangesToCells(current, rowCount, columnCount)
          .filter((candidate) => !sameCell(candidate, cell))
          .map((candidate) => rectangleFrom(candidate, candidate));
      });
      setAnchorCell(cell);
      setActiveCell(cell);
    },
    [columnCount, rowCount],
  );

  const extendTo = useCallback(
    (cell: CellCoord) => {
      const anchor = anchorCell ?? activeCell ?? cell;
      setSelectedRanges([rectangleFrom(anchor, cell)]);
      setAnchorCell(anchor);
      setActiveCell(cell);
    },
    [activeCell, anchorCell],
  );

  const finishPointerSelection = useCallback(() => {
    pointerSelectingRef.current = false;
    setDragSelection(null);
  }, []);

  useEffect(() => {
    const previous = previousGridSizeRef.current;
    if (
      previous.rowCount === rowCount &&
      previous.columnCount === columnCount
    ) {
      return;
    }
    previousGridSizeRef.current = { rowCount, columnCount };

    const nextSelectedRanges = clampRangesToGrid(
      selectedRangesRef.current,
      rowCount,
      columnCount,
    );
    const nextCopiedRanges = clampRangesToGrid(
      copiedRangesRef.current,
      rowCount,
      columnCount,
    );
    dragBaseRangesRef.current = clampRangesToGrid(
      dragBaseRangesRef.current,
      rowCount,
      columnCount,
    );
    selectedRangesRef.current = nextSelectedRanges;
    copiedRangesRef.current = nextCopiedRanges;
    setSelectedRanges(nextSelectedRanges);
    setCopiedRanges(nextCopiedRanges);
    setDragSelection((current) => {
      if (!current) return null;
      const anchor = clampCellToGrid(current.anchor, rowCount, columnCount);
      return anchor ? { ...current, anchor } : null;
    });

    const nextAnchorCell = clampCellToGrid(
      anchorCellRef.current,
      rowCount,
      columnCount,
    );
    const nextActiveCell = clampCellToGrid(
      activeCellRef.current,
      rowCount,
      columnCount,
    );
    setAnchorCell(
      nextAnchorCell && isCellInRanges(nextAnchorCell, nextSelectedRanges)
        ? nextAnchorCell
        : null,
    );
    setActiveCell(
      nextActiveCell && isCellInRanges(nextActiveCell, nextSelectedRanges)
        ? nextActiveCell
        : null,
    );
  }, [columnCount, rowCount]);

  useEffect(() => {
    if (!dragSelection) return;

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const selectCellUnderPointer = (clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY);
      if (!(target instanceof HTMLElement)) return;
      const cellElement = target.closest<HTMLElement>(
        "[data-row-index][data-col-index]",
      );
      if (!cellElement || !containerRef.current?.contains(cellElement)) return;

      const row = Number(cellElement.dataset.rowIndex);
      const col = Number(cellElement.dataset.colIndex);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;
      const cell = { row, col };
      setSelectedRanges(
        dragSelection.additive
          ? [...dragBaseRangesRef.current, rectangleFrom(dragSelection.anchor, cell)]
          : [rectangleFrom(dragSelection.anchor, cell)],
      );
      setActiveCell(cell);
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      selectCellUnderPointer(event.clientX, event.clientY);
    };
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", finishPointerSelection);
    document.addEventListener("pointercancel", finishPointerSelection);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishPointerSelection);
      document.removeEventListener("pointercancel", finishPointerSelection);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [containerRef, dragSelection, finishPointerSelection]);

  useEffect(
    () => () => {
      clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const pointerHandlers = useCallback(
    (cell: CellCoord) => ({
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0) return;
        event.stopPropagation();
        const additive = event.metaKey || event.ctrlKey;
        const wasSelected = isCellInRanges(cell, selectedRanges);
        dragBaseRangesRef.current = additive
          ? wasSelected
            ? expandRangesToCells(selectedRanges, rowCount, columnCount)
                .filter((candidate) => !sameCell(candidate, cell))
                .map((candidate) => rectangleFrom(candidate, candidate))
            : selectedRanges
          : [];
        pointerSelectingRef.current = true;
        if (event.shiftKey) extendTo(cell);
        else if (additive) toggle(cell);
        else selectSingle(cell);
        setDragSelection({
          anchor: event.shiftKey
            ? (anchorCell ?? activeCell ?? cell)
            : cell,
          additive,
        });
        const target = event.target;
        const interactive =
          target instanceof HTMLElement &&
          target.closest("input, textarea, select, [contenteditable='true']");
        if (!interactive) {
          event.preventDefault();
        }
      },
      onPointerUp: finishPointerSelection,
      onPointerCancel: finishPointerSelection,
    }),
    [
      activeCell,
      anchorCell,
      columnCount,
      extendTo,
      finishPointerSelection,
      rowCount,
      selectedRanges,
      selectSingle,
      toggle,
    ],
  );

  const handleCellFocus = useCallback(
    (cell: CellCoord) => {
      if (programmaticFocusRef.current) {
        programmaticFocusRef.current = false;
        return;
      }
      if (isCellInRanges(cell, selectedRanges)) {
        setActiveCell(cell);
        return;
      }
      selectSingle(cell);
    },
    [selectedRanges, selectSingle],
  );

  const moveActive = useCallback(
    (key: SpreadsheetArrowKey, extend: boolean): CellCoord | null => {
      const start = activeCell ?? anchorCell ?? { row: 0, col: 0 };
      const next = moveCellWithinBounds(start, key, rowCount, columnCount);
      if (!next) return null;
      if (extend) extendTo(next);
      else selectSingle(next);
      programmaticFocusRef.current = true;
      focusCell(next);
      return next;
    },
    [activeCell, anchorCell, columnCount, extendTo, focusCell, rowCount, selectSingle],
  );

  const markCopied = useCallback(() => {
    setCopiedRanges(selectedRanges);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      setCopiedRanges([]);
      copiedTimerRef.current = undefined;
    }, copiedHighlightMs);
  }, [copiedHighlightMs, selectedRanges]);

  const clearCopied = useCallback(() => {
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = undefined;
    setCopiedRanges([]);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedRanges([]);
    setAnchorCell(null);
    setActiveCell(null);
    clearCopied();
  }, [clearCopied]);

  return useMemo(
    () => ({
      selectedRanges,
      anchorCell,
      activeCell,
      copiedRanges,
      selectedCells: () =>
        expandRangesToCells(selectedRanges, rowCount, columnCount),
      selectSingle,
      toggle,
      selectRange,
      extendTo,
      pointerHandlers,
      handleCellFocus,
      moveActive,
      markCopied,
      clearCopied,
      clearSelection,
      cellState: (cell: CellCoord) => ({
        selected: isCellInRanges(cell, selectedRanges),
        active: sameCell(activeCell, cell),
        copied: isCellInRanges(cell, copiedRanges),
      }),
    }),
    [
      activeCell,
      anchorCell,
      clearCopied,
      clearSelection,
      columnCount,
      copiedRanges,
      extendTo,
      handleCellFocus,
      markCopied,
      moveActive,
      selectRange,
      pointerHandlers,
      rowCount,
      selectSingle,
      selectedRanges,
      toggle,
    ],
  );
}
