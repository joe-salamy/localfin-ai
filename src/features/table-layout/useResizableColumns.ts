import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CSSProperties,
  HTMLAttributes,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  subscribeToTableColumnWidthReset,
  readTableColumnWidths,
  writeTableColumnWidths,
} from "@/features/table-layout/storage";

const MIN_COLUMN_WIDTH_PX = 48;
const MAX_COLUMN_WIDTH_PX = 640;

export interface ResizableColumnDef {
  id: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
}

export interface ResolvedResizableColumn extends ResizableColumnDef {
  width: number;
  minWidth: number;
  maxWidth: number;
}

interface DragState {
  columnId: string;
  startX: number;
  startWidth: number;
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  if (!Number.isFinite(width)) return minWidth;
  return Math.min(maxWidth, Math.max(minWidth, width));
}

function resolveColumn(
  def: ResizableColumnDef,
  persistedWidth: number | undefined,
): ResolvedResizableColumn {
  const minWidth = def.minWidth ?? MIN_COLUMN_WIDTH_PX;
  const maxWidth = def.maxWidth ?? MAX_COLUMN_WIDTH_PX;
  return {
    ...def,
    minWidth,
    maxWidth,
    width: clampWidth(persistedWidth ?? def.defaultWidth, minWidth, maxWidth),
  };
}

function buildWidthRecord(columns: readonly ResolvedResizableColumn[]) {
  return Object.fromEntries(columns.map((column) => [column.id, column.width]));
}

function visualColumnIndex(cell: HTMLTableCellElement): number {
  let index = 0;
  let sibling = cell.previousElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLTableCellElement) {
      index += sibling.colSpan;
    }
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function cellAtColumn(
  row: HTMLTableRowElement,
  columnIndex: number,
): HTMLTableCellElement | null {
  let currentIndex = 0;
  for (const cell of Array.from(row.cells)) {
    const nextIndex = currentIndex + cell.colSpan;
    if (columnIndex >= currentIndex && columnIndex < nextIndex) {
      return cell.colSpan === 1 ? cell : null;
    }
    currentIndex = nextIndex;
  }
  return null;
}

function replaceFormControlsWithValues(
  source: HTMLTableCellElement,
  clone: HTMLTableCellElement,
): void {
  const sourceControls = source.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input, select, textarea");
  const clonedControls = clone.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input, select, textarea");

  sourceControls.forEach((sourceControl, index) => {
    const clonedControl = clonedControls.item(index);
    if (!clonedControl) return;

    let value = "";
    if (sourceControl instanceof HTMLSelectElement) {
      value = sourceControl.selectedOptions.item(0)?.textContent ?? "";
    } else {
      value = sourceControl.value || sourceControl.placeholder;
    }

    const replacement = document.createElement("span");
    replacement.className = sourceControl.className;
    replacement.style.cssText = sourceControl.style.cssText;
    replacement.style.display = "inline-block";
    replacement.style.width = "max-content";
    replacement.style.minWidth = "0";
    replacement.style.maxWidth = "none";
    replacement.style.whiteSpace = "pre";
    replacement.textContent = value || "\u00a0";
    clonedControl.replaceWith(replacement);
  });
}

function measureColumnContentWidth(handle: HTMLSpanElement): number | null {
  const headerCell = handle.closest("th");
  const table = handle.closest("table");
  if (!headerCell || !table || !document.body) return null;

  const columnIndex = visualColumnIndex(headerCell);
  const measurementTable = document.createElement("table");
  measurementTable.className = table.className;
  measurementTable.style.position = "fixed";
  measurementTable.style.left = "-10000px";
  measurementTable.style.top = "0";
  measurementTable.style.width = "max-content";
  measurementTable.style.minWidth = "0";
  measurementTable.style.maxWidth = "none";
  measurementTable.style.tableLayout = "auto";
  measurementTable.style.visibility = "hidden";
  measurementTable.style.pointerEvents = "none";

  const measurementBody = document.createElement("tbody");
  measurementTable.append(measurementBody);

  for (const row of Array.from(table.rows)) {
    const sourceCell = cellAtColumn(row, columnIndex);
    if (!sourceCell) continue;

    const clone = sourceCell.cloneNode(true) as HTMLTableCellElement;
    clone.querySelectorAll('[role="separator"]').forEach((separator) => {
      separator.remove();
    });
    replaceFormControlsWithValues(sourceCell, clone);
    clone.style.width = "max-content";
    clone.style.minWidth = "0";
    clone.style.maxWidth = "none";
    clone.style.whiteSpace = "nowrap";

    const measurementRow = document.createElement("tr");
    measurementRow.append(clone);
    measurementBody.append(measurementRow);
  }

  if (measurementBody.rows.length === 0) return null;

  document.body.append(measurementTable);
  const width = Math.ceil(
    Math.max(
      measurementTable.getBoundingClientRect().width,
      measurementTable.scrollWidth,
    ),
  );
  measurementTable.remove();
  return width;
}

export function useResizableColumns(
  tableId: string,
  columnDefs: readonly ResizableColumnDef[],
): {
  columns: ResolvedResizableColumn[];
  totalWidth: number;
  getColStyle: (columnId: string) => CSSProperties;
  getHeaderStyle: (columnId: string) => CSSProperties;
  getResizeHandleProps: (columnId: string) => HTMLAttributes<HTMLSpanElement>;
} {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    readTableColumnWidths(tableId),
  );

  useEffect(() => {
    const refreshWidths = () => setWidths(readTableColumnWidths(tableId));
    refreshWidths();
    return subscribeToTableColumnWidthReset(refreshWidths);
  }, [tableId]);

  const columns = useMemo(
    () => columnDefs.map((def) => resolveColumn(def, widths[def.id])),
    [columnDefs, widths],
  );

  const columnMap = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );

  const totalWidth = useMemo(
    () => columns.reduce((total, column) => total + column.width, 0),
    [columns],
  );

  const persistWidths = useCallback(
    (nextWidths: Record<string, number>) => {
      const nextColumns = columnDefs.map((def) =>
        resolveColumn(def, nextWidths[def.id]),
      );
      writeTableColumnWidths(tableId, buildWidthRecord(nextColumns));
    },
    [columnDefs, tableId],
  );

  const getColStyle = useCallback(
    (columnId: string): CSSProperties => {
      const column = columnMap.get(columnId);
      if (!column) return {};
      return { width: column.width };
    },
    [columnMap],
  );

  const getHeaderStyle = useCallback(
    (columnId: string): CSSProperties => {
      const column = columnMap.get(columnId);
      if (!column) return {};
      return {
        width: column.width,
        minWidth: column.minWidth,
        maxWidth: column.maxWidth,
      };
    },
    [columnMap],
  );

  const getResizeHandleProps = useCallback(
    (columnId: string): HTMLAttributes<HTMLSpanElement> => ({
      role: "separator",
      "aria-orientation": "vertical",
      title: "Drag to resize; double-click to fit contents",
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
      onDoubleClick: (event) => {
        const column = columnMap.get(columnId);
        if (!column) return;

        event.preventDefault();
        event.stopPropagation();
        const measuredWidth = measureColumnContentWidth(event.currentTarget);
        if (measuredWidth == null) return;

        const nextWidth = clampWidth(
          measuredWidth,
          column.minWidth,
          column.maxWidth,
        );
        setWidths((current) => {
          const next = { ...current, [columnId]: nextWidth };
          persistWidths(next);
          return next;
        });
      },
      onPointerDown: (event: ReactPointerEvent<HTMLSpanElement>) => {
        const column = columnMap.get(columnId);
        if (!column) return;

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);

        const drag: DragState = {
          columnId,
          startX: event.clientX,
          startWidth: column.width,
        };

        const handlePointerMove = (moveEvent: PointerEvent) => {
          const nextWidth = clampWidth(
            drag.startWidth + moveEvent.clientX - drag.startX,
            column.minWidth,
            column.maxWidth,
          );
          setWidths((current) => {
            const next = { ...current, [drag.columnId]: nextWidth };
            persistWidths(next);
            return next;
          });
        };

        const removeListeners = () => {
          document.removeEventListener("pointermove", handlePointerMove);
          document.removeEventListener("pointerup", removeListeners);
          document.removeEventListener("pointercancel", removeListeners);
        };

        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", removeListeners);
        document.addEventListener("pointercancel", removeListeners);
      },
    }),
    [columnMap, persistWidths],
  );

  return {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  };
}
