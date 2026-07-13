import { createRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useSpreadsheetSelection } from "./useSpreadsheetSelection";

afterEach(() => vi.useRealTimers());

test("selects, extends, moves, and reports copied cell state", () => {
  vi.useFakeTimers();
  const containerRef = createRef<HTMLElement>();
  const focusCell = vi.fn();
  const { result } = renderHook(() =>
    useSpreadsheetSelection({
      rowCount: 3,
      columnCount: 3,
      containerRef,
      focusCell,
      copiedHighlightMs: 100,
    }),
  );

  act(() => result.current.selectSingle({ row: 0, col: 0 }));
  act(() => result.current.extendTo({ row: 1, col: 1 }));
  expect(result.current.selectedCells()).toEqual([
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
  ]);

  act(() => result.current.markCopied());
  expect(result.current.cellState({ row: 1, col: 1 }).copied).toBe(true);
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(result.current.cellState({ row: 1, col: 1 }).copied).toBe(false);

  act(() => {
    result.current.moveActive("ArrowRight", false);
  });
  expect(focusCell).toHaveBeenCalledWith({ row: 1, col: 2 });
  expect(result.current.activeCell).toEqual({ row: 1, col: 2 });
});

test("unmount clears the copied highlight timer", () => {
  vi.useFakeTimers();
  const clearSpy = vi.spyOn(globalThis, "clearTimeout");
  const { result, unmount } = renderHook(() =>
    useSpreadsheetSelection({
      rowCount: 1,
      columnCount: 1,
      containerRef: createRef<HTMLElement>(),
      focusCell: vi.fn(),
    }),
  );
  act(() => result.current.selectSingle({ row: 0, col: 0 }));
  act(() => result.current.markCopied());
  unmount();
  expect(clearSpy).toHaveBeenCalled();
});
