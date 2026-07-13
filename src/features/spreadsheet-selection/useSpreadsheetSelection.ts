import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Dispatch,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from "react";
import {
  expandRangesToCells,
  isCellInRanges,
  moveCellWithinBounds,
  rectangleFrom,
  type CellCoord,
  type CellRange,
  type SpreadsheetArrowKey,
} from "./selection";

export interface UseSpreadsheetSelectionOptions {
  rowCount: number;
  columnCount: number;
  containerRef: RefObject<HTMLElement | null>;
  focusCell(cell: CellCoord): void;
  copiedHighlightMs?: number;
}

export interface SpreadsheetSelectionController {
  selectedRanges: CellRange[];
  anchorCell: CellCoord | null;
  activeCell: CellCoord | null;
  copiedRanges: CellRange[];
  setSelectedRanges: Dispatch<SetStateAction<CellRange[]>>;
  setAnchorCell: Dispatch<SetStateAction<CellCoord | null>>;
  setActiveCell: Dispatch<SetStateAction<CellCoord | null>>;
  setCopiedRanges: Dispatch<SetStateAction<CellRange[]>>;
  dragSelection: { anchor: CellCoord; additive: boolean } | null;
  setDragSelection: Dispatch<
    SetStateAction<{ anchor: CellCoord; additive: boolean } | null>
  >;
  pointerSelectingRef: MutableRefObject<boolean>;
  programmaticFocusRef: MutableRefObject<boolean>;
  selectedCells(): CellCoord[];
  selectSingle(cell: CellCoord): void;
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

export function useSpreadsheetSelection({
  rowCount,
  columnCount,
  containerRef,
  focusCell,
  copiedHighlightMs = 800,
}: UseSpreadsheetSelectionOptions): SpreadsheetSelectionController {
  const [selectedRanges, setSelectedRanges] = useState<CellRange[]>([]);
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [copiedRanges, setCopiedRanges] = useState<CellRange[]>([]);
  const [dragSelection, setDragSelection] = useState<{
    anchor: CellCoord;
    additive: boolean;
  } | null>(null);
  const pointerSelectingRef = useRef(false);
  const dragAnchorRef = useRef<CellCoord | null>(null);
  const additiveDragRef = useRef(false);
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const programmaticFocusRef = useRef(false);

  const selectSingle = useCallback((cell: CellCoord) => {
    setSelectedRanges([rectangleFrom(cell, cell)]);
    setAnchorCell(cell);
    setActiveCell(cell);
  }, []);

  const toggle = useCallback((cell: CellCoord) => {
    setSelectedRanges((current) => {
      if (isCellInRanges(cell, current)) {
        return current.filter((range) => !isCellInRanges(cell, [range]));
      }
      return [...current, rectangleFrom(cell, cell)];
    });
    setAnchorCell(cell);
    setActiveCell(cell);
  }, []);

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
    dragAnchorRef.current = null;
    additiveDragRef.current = false;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("pointerup", finishPointerSelection);
    container.addEventListener("pointercancel", finishPointerSelection);
    return () => {
      container.removeEventListener("pointerup", finishPointerSelection);
      container.removeEventListener("pointercancel", finishPointerSelection);
    };
  }, [containerRef, finishPointerSelection]);

  useEffect(
    () => () => {
      clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const pointerHandlers = useCallback(
    (cell: CellCoord) => ({
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        dragAnchorRef.current = cell;
        additiveDragRef.current = event.metaKey || event.ctrlKey;
        if (event.shiftKey) extendTo(cell);
        else if (additiveDragRef.current) toggle(cell);
        else selectSingle(cell);
      },
      onPointerUp: finishPointerSelection,
      onPointerCancel: finishPointerSelection,
    }),
    [extendTo, finishPointerSelection, selectSingle, toggle],
  );

  const handleCellFocus = useCallback(
    (cell: CellCoord) => {
      if (programmaticFocusRef.current) {
        programmaticFocusRef.current = false;
        return;
      }
      selectSingle(cell);
    },
    [selectSingle],
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

  const clearSelection = useCallback(() => {
    setSelectedRanges([]);
    setAnchorCell(null);
    setActiveCell(null);
    setCopiedRanges([]);
  }, []);

  return useMemo(
    () => ({
      selectedRanges,
      anchorCell,
      activeCell,
      copiedRanges,
      setSelectedRanges,
      setAnchorCell,
      setActiveCell,
      setCopiedRanges,
      dragSelection,
      setDragSelection,
      pointerSelectingRef,
      programmaticFocusRef,
      selectedCells: () =>
        expandRangesToCells(selectedRanges, rowCount, columnCount),
      selectSingle,
      toggle,
      extendTo,
      pointerHandlers,
      handleCellFocus,
      moveActive,
      markCopied,
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
      clearSelection,
      columnCount,
      copiedRanges,
      dragSelection,
      extendTo,
      handleCellFocus,
      markCopied,
      moveActive,
      pointerHandlers,
      rowCount,
      selectSingle,
      selectedRanges,
      toggle,
    ],
  );
}
