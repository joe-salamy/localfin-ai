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
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
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
