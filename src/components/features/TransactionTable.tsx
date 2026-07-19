import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent } from "react";
import type { CreateTagData,
SuspectTransactionFinding,
TransactionKind,
TransactionWithDetails,
Subcategory,
Tag,
UpdateTransactionData, } from "@shared/contracts"
import { format, parseISO } from "date-fns";
import { Pencil, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDeleteModal } from "@/components/features/ConfirmDeleteModal";
import { TagChip, TagPicker } from "@/components/features/TagPicker";
import type { TagPickerCreateOptions } from "@/components/features/TagPicker";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { Checkbox } from "@/components/ui/Checkbox";
import { formatCurrency, cn } from "@/lib/utils";
import { DISPLAY_DATE_FORMAT } from "@/config/constants";
import {
  buildCategoryLookup,
  formatSubcategoryLabel,
  formatNullableSubcategoryLabel,
} from "@/lib/categoryLabels";
import { useShortcut, useShortcutScope } from "@/features/shortcuts/hooks";
import {
  useAmountGradient,
  useSuccessToast,
} from "@/features/display-settings/hooks";
import { useFlaggedWords } from "@/features/flagged-words/hooks";
import type { Category } from "@shared/contracts"
import { useResizableColumns } from "@/features/table-layout/useResizableColumns";
import {
  expandRangesToCells,
  formatClipboardMatrix,
  isCellInRanges,
  isSingleCellMatrix,
  moveCellWithinBounds,
  parseClipboardMatrix,
  rectangleFrom,
  selectionBoundingRange,
  topLeftCell,
} from "@/features/spreadsheet-selection/selection";
import type {
  CellCoord,
  CellRange,
  SpreadsheetArrowKey,
} from "@/features/spreadsheet-selection/selection";
import {
  isNativeEditableTarget,
} from "@/features/spreadsheet-selection/domTargets";
import { useSpreadsheetSelection } from "@/features/spreadsheet-selection/useSpreadsheetSelection";
import {
  historyTransactionCellFields,
  kindHasSubcategory,
  parsePastedAmount,
  parsePastedDate,
  resolveKind,
  resolveSubcategoryId,
  resolveTagIds,
} from "@/lib/transactionCellParsing";
import type { HistoryTransactionCellField } from "@/lib/transactionCellParsing";
import {
  scaleValueColorClass,
  transactionAmountScaleValue,
} from "@/lib/financialColorScale";
import { handleEnterSave } from "@/lib/enterSave";
import { shouldHandleFieldEditDoubleClick } from "@/lib/fieldEditDoubleClick";
import { SortIcon } from "@/features/transaction-history/TransactionHistoryHeader";
import { transactionHistoryColumns } from "@/features/transaction-history/transactionHistoryColumns";
import { TransactionEditRow } from "@/features/transaction-history/TransactionEditRow";
import { TransactionHistoryRow } from "@/features/transaction-history/TransactionHistoryRow";

interface TransactionTableProps {
  transactions: TransactionWithDetails[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  onEdit: (
    id: string,
    updates: UpdateTransactionData,
    options?: { silent?: boolean },
  ) => Promise<boolean>;
  onEditMany: (
    changes: Array<{ id: string; updates: UpdateTransactionData }>,
    options?: { silent?: boolean; label?: string },
  ) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  categories: Category[];
  subcategories: Subcategory[];
  tags: Tag[];
  onCreateTag: (
    data: CreateTagData,
    options?: TagPickerCreateOptions,
  ) => Promise<Tag>;
  suspectFindings?: SuspectTransactionFinding[];
}

interface EditState {
  date: string;
  name: string;
  amount: string;
  kind: TransactionKind;
  subcategory_id: string;
  comment: string;
  tag_ids: string[];
}


export function TransactionTable({
  transactions,
  selectedIds,
  onSelectionChange,
  sortColumn,
  sortDirection,
  onSort,
  onEdit,
  onEditMany,
  onDelete,
  categories,
  subcategories,
  suspectFindings = [],
  tags,
  onCreateTag,
}: TransactionTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    date: "",
    name: "",
    amount: "",
    kind: "expense",
    subcategory_id: "",
    comment: "",
    tag_ids: [],
  });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<TransactionWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(
    transactions[0]?.id ?? null,
  );
  const [tableFocused, setTableFocused] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const {
    selectedRanges,
    setSelectedRanges,
    anchorCell,
    setAnchorCell,
    activeCell,
    setActiveCell,
    copiedRanges,
    setCopiedRanges,
    dragSelection,
    setDragSelection,
    pointerSelectingRef,
    programmaticFocusRef: programmaticCellFocusRef,
  } = useSpreadsheetSelection({
    rowCount: transactions.length,
    columnCount: historyTransactionCellFields.length,
    containerRef: tableContainerRef,
    focusCell: (cell) => {
      tableContainerRef.current
        ?.querySelector<HTMLElement>(
          `[data-row-index="${cell.row}"][data-col-index="${cell.col}"]`,
        )
        ?.focus();
    },
    copiedHighlightMs: 1200,
  });
  const copiedRangeTimeoutRef = useRef<number | null>(null);
  const dragBaseRangesRef = useRef<CellRange[]>([]);
  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns(
    "transaction-history.transactions",
    transactionHistoryColumns,
  );
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const getGradientStyle = useAmountGradient(
    transactions.flatMap((transaction) => {
      const scaleValue = transactionAmountScaleValue(
        transaction.amount,
        transaction.kind,
      );
      return scaleValue == null ? [] : [scaleValue];
    }),
  );
  const { findMatches } = useFlaggedWords();
  const successToast = useSuccessToast();
  const categoryLookup = buildCategoryLookup(categories);
  const suspectFindingsByTransaction = useMemo(() => {
    const groups = new Map<string, SuspectTransactionFinding[]>();
    for (const finding of suspectFindings) {
      if (finding.status !== "open") continue;
      const current = groups.get(finding.transaction_id);
      if (current) {
        current.push(finding);
      } else {
        groups.set(finding.transaction_id, [finding]);
      }
    }
    return groups;
  }, [suspectFindings]);

  const allSelected =
    transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id));
  const someSelected =
    !allSelected && transactions.some((t) => selectedIds.has(t.id));
  const focusedTransaction =
    transactions.find((transaction) => transaction.id === focusedId) ??
    transactions[0] ??
    null;

  useShortcutScope(
    "transactionHistoryTable",
    tableFocused || editingId !== null,
  );
  useShortcutScope("transactionHistoryEdit", editingId !== null);

  const clearCopiedRanges = useCallback(() => {
    if (
      copiedRangeTimeoutRef.current !== null &&
      typeof window !== "undefined"
    ) {
      window.clearTimeout(copiedRangeTimeoutRef.current);
    }
    copiedRangeTimeoutRef.current = null;
    setCopiedRanges([]);
  }, [setCopiedRanges]);

  const markCopiedRanges = useCallback(() => {
    clearCopiedRanges();
    setCopiedRanges(selectedRanges.map((range) => ({ ...range })));
    if (typeof window !== "undefined") {
      copiedRangeTimeoutRef.current = window.setTimeout(
        clearCopiedRanges,
        1200,
      );
    }
  }, [clearCopiedRanges, selectedRanges, setCopiedRanges]);

  useEffect(() => clearCopiedRanges, [clearCopiedRanges]);

  useEffect(() => {
    if (transactions.length === 0) {
      setFocusedId(null);
      return;
    }
    if (
      !focusedId ||
      !transactions.some((transaction) => transaction.id === focusedId)
    ) {
      setFocusedId(transactions[0]?.id ?? null);
    }
  }, [focusedId, transactions]);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(transactions.map((t) => t.id)));
    }
  }, [allSelected, onSelectionChange, transactions]);

  const toggleOne = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectionChange(next);
    },
    [onSelectionChange, selectedIds],
  );

  const focusRow = useCallback((id: string | null) => {
    if (!id) return;
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  }, []);

  const focusRowByOffset = useCallback(
    (offset: number) => {
      if (transactions.length === 0) return;
      const currentIndex = Math.max(
        0,
        transactions.findIndex((transaction) => transaction.id === focusedId),
      );
      const nextIndex = Math.max(
        0,
        Math.min(currentIndex + offset, transactions.length - 1),
      );
      focusRow(transactions[nextIndex]?.id ?? null);
    },
    [focusRow, focusedId, transactions],
  );

  const startEdit = useCallback((t: TransactionWithDetails) => {
    setEditingId(t.id);
    setEditState({
      date: t.date,
      name: t.name,
      amount: String(t.amount),
      kind: t.kind,
      subcategory_id: t.subcategory_id ?? "",
      comment: t.comment ?? "",
      tag_ids: t.tags.map((tag) => tag.id),
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const saved = await onEdit(editingId, {
        date: editState.date,
        name: editState.name,
        amount: parseFloat(editState.amount),
        kind: editState.kind,
        subcategory_id: kindHasSubcategory(editState.kind)
          ? editState.subcategory_id || null
          : null,
        comment: editState.comment || null,
        tag_ids: editState.tag_ids,
      });
      if (saved) setEditingId(null);
    } finally {
      setSaving(false);
    }
  }, [editState, editingId, onEdit]);

  function handleEditRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (saving) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
      return;
    }
    handleEnterSave(event, () => {
      void saveEdit();
    });
  }

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  useShortcut("transactionHistory.selectAll", toggleAll);
  useShortcut(
    "transactionHistory.toggleFocusedRow",
    useCallback(() => {
      if (focusedTransaction) toggleOne(focusedTransaction.id);
    }, [focusedTransaction, toggleOne]),
  );
  useShortcut(
    "transactionHistory.editFocusedRow",
    useCallback(() => {
      if (focusedTransaction && editingId === null)
        startEdit(focusedTransaction);
    }, [editingId, focusedTransaction, startEdit]),
  );
  useShortcut(
    "transactionHistory.saveEdit",
    useCallback(() => {
      void saveEdit();
    }, [saveEdit]),
  );
  useShortcut("transactionHistory.cancelEdit", cancelEdit, {
    enabled: editingId !== null,
  });
  useShortcut(
    "transactionHistory.deleteFocusedRow",
    useCallback(() => {
      if (focusedTransaction && editingId === null)
        setDeleteTarget(focusedTransaction);
    }, [editingId, focusedTransaction]),
  );
  useShortcut(
    "transactionHistory.sortDate",
    useCallback(() => onSort("date"), [onSort]),
  );
  useShortcut(
    "transactionHistory.sortName",
    useCallback(() => onSort("name"), [onSort]),
  );
  useShortcut(
    "transactionHistory.sortAmount",
    useCallback(() => onSort("amount"), [onSort]),
  );
  useShortcut(
    "transactionHistory.sortBalance",
    useCallback(() => onSort("balance"), [onSort]),
  );
  useShortcut(
    "transactionHistory.nextRow",
    useCallback(() => focusRowByOffset(1), [focusRowByOffset]),
  );
  useShortcut(
    "transactionHistory.previousRow",
    useCallback(() => focusRowByOffset(-1), [focusRowByOffset]),
  );
  useShortcut(
    "transactionHistory.firstRow",
    useCallback(
      () => focusRow(transactions[0]?.id ?? null),
      [focusRow, transactions],
    ),
  );
  useShortcut(
    "transactionHistory.lastRow",
    useCallback(
      () => focusRow(transactions[transactions.length - 1]?.id ?? null),
      [focusRow, transactions],
    ),
  );

  const applySubcategoryPaste = async (
    e: ClipboardEvent<HTMLElement>,
    transaction: TransactionWithDetails,
  ) => {
    if (e.defaultPrevented) return;

    const text = e.clipboardData.getData("text/plain");
    const values = text
      .split(/\r?\n/)
      .map((line) => line.split("\t")[0]?.trim() ?? "")
      .filter(Boolean);
    if (values.length === 0) return;

    const resolvedIds = values.map((value) =>
      resolveSubcategoryId(value, categories, subcategories),
    );
    if (resolvedIds.every((id) => !id)) return;

    e.preventDefault();

    if (editingId === transaction.id) {
      const firstResolvedId = resolvedIds.find(
        (id): id is string => id != null,
      );
      if (firstResolvedId) {
        setEditState((current) => ({
          ...current,
          subcategory_id: firstResolvedId,
        }));
      }
      return;
    }

    const targetTransactions =
      selectedIds.size > 0
        ? transactions.filter((item) => selectedIds.has(item.id))
        : transactions.slice(
            transactions.findIndex((item) => item.id === transaction.id),
          );
    const updates =
      values.length === 1
        ? targetTransactions.map((item) => ({
            item,
            subcategoryId: resolvedIds[0],
          }))
        : targetTransactions
            .slice(0, resolvedIds.length)
            .map((item, index) => ({
              item,
              subcategoryId: resolvedIds[index],
            }));

    const changes = updates.flatMap((update) =>
      update.subcategoryId
        ? [
            {
              id: update.item.id,
              updates: { subcategory_id: update.subcategoryId },
            },
          ]
        : [],
    );
    if (changes.length === 0) return;

    const ok = await onEditMany(changes, {
      silent: true,
      label: "Paste transaction subcategories",
    });
    if (ok) {
      successToast(
        `Updated ${changes.length} transaction${changes.length === 1 ? "" : "s"}.`,
      );
    } else {
      toast.warning("Pasted subcategory update failed.");
    }
  };

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
      if (!cellElement || !tableContainerRef.current?.contains(cellElement)) {
        return;
      }

      const row = Number(cellElement.dataset.rowIndex);
      const col = Number(cellElement.dataset.colIndex);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;

      const focus = { row, col };
      const range = rectangleFrom(dragSelection.anchor, focus);
      setSelectedRanges(
        dragSelection.additive
          ? [...dragBaseRangesRef.current, range]
          : [range],
      );
      setActiveCell(focus);
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      selectCellUnderPointer(event.clientX, event.clientY);
    };
    const stopDrag = () => {
      pointerSelectingRef.current = false;
      setDragSelection(null);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopDrag);
      document.removeEventListener("pointercancel", stopDrag);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [
    dragSelection,
    pointerSelectingRef,
    setActiveCell,
    setDragSelection,
    setSelectedRanges,
  ]);

  const expandSelectedCells = useCallback(
    (): CellCoord[] =>
      expandRangesToCells(
        selectedRanges,
        transactions.length,
        historyTransactionCellFields.length,
      ),
    [selectedRanges, transactions.length],
  );

  const selectHistoryCell = useCallback((cell: CellCoord) => {
    setSelectedRanges([rectangleFrom(cell, cell)]);
    setAnchorCell(cell);
    setActiveCell(cell);
  }, [setActiveCell, setAnchorCell, setSelectedRanges]);

  const toggleHistoryCell = useCallback(
    (cell: CellCoord) => {
      if (!isCellInRanges(cell, selectedRanges)) {
        setSelectedRanges((current) => [...current, rectangleFrom(cell, cell)]);
        setAnchorCell(cell);
        setActiveCell(cell);
        return;
      }

      const cells = expandSelectedCells().filter(
        (selectedCell) =>
          selectedCell.row !== cell.row || selectedCell.col !== cell.col,
      );
      setSelectedRanges(
        cells.map((selectedCell) => rectangleFrom(selectedCell, selectedCell)),
      );
      setAnchorCell(cell);
      setActiveCell(cell);
    },
    [
      expandSelectedCells,
      selectedRanges,
      setActiveCell,
      setAnchorCell,
      setSelectedRanges,
    ],
  );

  const getHistoryCellSelectionHandlers = useCallback(
    (rowIndex: number, colIndex: number) => ({
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.stopPropagation();

        pointerSelectingRef.current = true;
        const cell = { row: rowIndex, col: colIndex };
        const additive = event.ctrlKey || event.metaKey;
        const dragAnchor = event.shiftKey
          ? (anchorCell ?? activeCell ?? cell)
          : cell;
        const interactive = isNativeEditableTarget(event.target);

        if (event.shiftKey) {
          setSelectedRanges([rectangleFrom(dragAnchor, cell)]);
          setActiveCell(cell);
        } else if (additive) {
          toggleHistoryCell(cell);
        } else {
          selectHistoryCell(cell);
        }

        if (!interactive) event.preventDefault();
        dragBaseRangesRef.current = additive ? selectedRanges : [];
        setDragSelection({ anchor: dragAnchor, additive });
      },
      onPointerUp: () => {
        pointerSelectingRef.current = false;
        setDragSelection(null);
      },
      onPointerCancel: () => {
        pointerSelectingRef.current = false;
        setDragSelection(null);
      },
    }),
    [
      activeCell,
      anchorCell,
      pointerSelectingRef,
      selectHistoryCell,
      selectedRanges,
      setActiveCell,
      setDragSelection,
      setSelectedRanges,
      toggleHistoryCell,
    ],
  );

  const focusHistoryCell = useCallback(
    (transactionId: string, rowIndex: number, colIndex: number) => {
      setFocusedId(transactionId);
      if (pointerSelectingRef.current || programmaticCellFocusRef.current) return;
      const cell = { row: rowIndex, col: colIndex };
      setActiveCell(cell);
      if (!isCellInRanges(cell, selectedRanges)) {
        setSelectedRanges([rectangleFrom(cell, cell)]);
        setAnchorCell(cell);
      }
    },
    [
      pointerSelectingRef,
      programmaticCellFocusRef,
      selectedRanges,
      setActiveCell,
      setAnchorCell,
      setSelectedRanges,
    ],
  );

  const focusHistoryGridCell = useCallback(
    (rowIndex: number, colIndex: number) => {
      const target = tableContainerRef.current?.querySelector(
        `[data-row-index="${rowIndex}"][data-col-index="${colIndex}"]`,
      );
      if (target instanceof HTMLElement) {
        programmaticCellFocusRef.current = true;
        target.focus();
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            programmaticCellFocusRef.current = false;
          });
        } else {
          programmaticCellFocusRef.current = false;
        }
      }
    },
    [programmaticCellFocusRef],
  );

  const getHistoryCellClassName = useCallback(
    (rowIndex: number, colIndex: number, className?: string) => {
      const cell = { row: rowIndex, col: colIndex };
      const selected = isCellInRanges(cell, selectedRanges);
      const active =
        activeCell?.row === rowIndex && activeCell.col === colIndex;
      const copied = isCellInRanges(cell, copiedRanges);
      return cn(
        className,
        selected && "bg-ring/15 outline outline-1 outline-ring",
        active && "outline-2",
        copied && "bg-primary/10 outline-dashed outline-2 outline-primary",
      );
    },
    [activeCell, copiedRanges, selectedRanges],
  );

  const getHistoryCellDisplayValue = useCallback(
    (
      transaction: TransactionWithDetails,
      field: HistoryTransactionCellField,
    ): string => {
      if (field === "date")
        return format(parseISO(transaction.date), DISPLAY_DATE_FORMAT);
      if (field === "name") return transaction.name;
      if (field === "amount") return formatCurrency(transaction.amount);
      if (field === "kind") return transaction.kind;
      if (field === "subcategory_id") {
        return (
          formatNullableSubcategoryLabel(
            transaction.subcategory_name,
            transaction.category_type,
          ) ?? ""
        );
      }
      if (field === "tag_ids")
        return transaction.tags.map((tag) => tag.name).join(", ");
      return transaction.comment ?? "";
    },
    [],
  );

  const parseHistoryCellValue = useCallback(
    (
      field: HistoryTransactionCellField,
      value: string,
      transaction: TransactionWithDetails,
      mode: "paste" | "clear",
      draftKind: TransactionKind = transaction.kind,
    ): { updates: UpdateTransactionData; applied: boolean } => {
      if (mode === "clear") {
        if (field === "subcategory_id")
          return { updates: { subcategory_id: null }, applied: true };
        if (field === "tag_ids")
          return { updates: { tag_ids: [] }, applied: true };
        if (field === "comment")
          return { updates: { comment: null }, applied: true };
        return { updates: {}, applied: false };
      }

      if (field === "date") {
        const parsed = parsePastedDate(value);
        return parsed
          ? { updates: { date: parsed.isoDate }, applied: true }
          : { updates: {}, applied: false };
      }
      if (field === "name") {
        const name = value.trim();
        return name
          ? { updates: { name }, applied: true }
          : { updates: {}, applied: false };
      }
      if (field === "amount") {
        const amount = parsePastedAmount(value);
        return amount === null
          ? { updates: {}, applied: false }
          : { updates: { amount }, applied: true };
      }
      if (field === "kind") {
        const kind = resolveKind(value);
        if (!kind) return { updates: {}, applied: false };
        return {
          updates: {
            kind,
            subcategory_id: kindHasSubcategory(kind)
              ? transaction.subcategory_id
              : null,
          },
          applied: true,
        };
      }
      if (field === "subcategory_id") {
        if (!kindHasSubcategory(draftKind))
          return { updates: {}, applied: false };
        const subcategoryId = resolveSubcategoryId(
          value,
          categories,
          subcategories,
        );
        return subcategoryId
          ? { updates: { subcategory_id: subcategoryId }, applied: true }
          : { updates: {}, applied: false };
      }
      if (field === "tag_ids") {
        const tagIds = resolveTagIds(value, tags);
        if (tagIds.length === 0 || tagIds.length > 50) {
          return { updates: {}, applied: false };
        }
        return { updates: { tag_ids: tagIds }, applied: true };
      }

      return { updates: { comment: value.trim() || null }, applied: true };
    },
    [categories, subcategories, tags],
  );

  const writeHistorySelectionToClipboard = useCallback(
    (event: ClipboardEvent<HTMLElement>): boolean => {
      const bounds = selectionBoundingRange(selectedRanges);
      if (!bounds) return false;

      const matrix: string[][] = [];
      for (
        let rowIndex = bounds.startRow;
        rowIndex <= bounds.endRow;
        rowIndex++
      ) {
        const transaction = transactions[rowIndex];
        const values: string[] = [];
        for (
          let colIndex = bounds.startCol;
          colIndex <= bounds.endCol;
          colIndex++
        ) {
          const cell = { row: rowIndex, col: colIndex };
          const field = historyTransactionCellFields[colIndex];
          values.push(
            transaction && field && isCellInRanges(cell, selectedRanges)
              ? getHistoryCellDisplayValue(transaction, field)
              : "",
          );
        }
        matrix.push(values);
      }

      event.clipboardData.setData("text/plain", formatClipboardMatrix(matrix));
      event.preventDefault();
      return true;
    },
    [getHistoryCellDisplayValue, selectedRanges, transactions],
  );

  const applyHistoryClipboardMatrix = useCallback(
    async (
      matrix: string[][],
      startRow: number,
      startCol: number,
      mode: "paste" | "clear",
    ) => {
      const updatesById = new Map<
        string,
        { updates: UpdateTransactionData; cells: number }
      >();
      let skipped = 0;

      for (let rowOffset = 0; rowOffset < matrix.length; rowOffset++) {
        const transaction = transactions[startRow + rowOffset];
        if (!transaction) {
          skipped += matrix[rowOffset]?.length ?? 0;
          continue;
        }

        const existing = updatesById.get(transaction.id) ?? {
          updates: {},
          cells: 0,
        };
        const values = matrix[rowOffset] ?? [];
        for (let colOffset = 0; colOffset < values.length; colOffset++) {
          const field = historyTransactionCellFields[startCol + colOffset];
          if (!field) break;
          const draftKind = existing.updates.kind ?? transaction.kind;
          const result = parseHistoryCellValue(
            field,
            values[colOffset] ?? "",
            transaction,
            mode,
            draftKind,
          );
          if (!result.applied) {
            skipped++;
            continue;
          }
          existing.updates = { ...existing.updates, ...result.updates };
          existing.cells++;
        }
        if (existing.cells > 0) updatesById.set(transaction.id, existing);
      }

      const changes = Array.from(updatesById, ([id, entry]) => ({
        id,
        updates: entry.updates,
      }));
      const updatedCells = Array.from(updatesById.values()).reduce(
        (total, entry) => total + entry.cells,
        0,
      );
      const updatedRows = changes.length;
      const ok =
        changes.length === 0
          ? true
          : await onEditMany(changes, {
              silent: true,
              label:
                mode === "clear"
                  ? "Clear transaction cells"
                  : "Paste transaction cells",
            });

      if (ok && updatedRows > 0) {
        successToast(
          `Updated ${updatedCells} cell(s) across ${updatedRows} row(s).`,
        );
      }
      if (skipped > 0 || !ok) {
        toast.warning(
          `Skipped ${skipped} invalid cell(s); ${ok ? 0 : 1} row update(s) failed.`,
        );
      }
    },
    [onEditMany, parseHistoryCellValue, successToast, transactions],
  );

  const clearSelectedHistoryCells = useCallback(
    async (selectedCells: CellCoord[]) => {
      const updatesById = new Map<
        string,
        { updates: UpdateTransactionData; cells: number }
      >();

      for (const cell of selectedCells) {
        const transaction = transactions[cell.row];
        const field = historyTransactionCellFields[cell.col];
        if (!transaction || !field) continue;

        const existing = updatesById.get(transaction.id) ?? {
          updates: {},
          cells: 0,
        };
        const draftKind = existing.updates.kind ?? transaction.kind;
        const result = parseHistoryCellValue(
          field,
          "",
          transaction,
          "clear",
          draftKind,
        );
        if (!result.applied) continue;

        existing.updates = { ...existing.updates, ...result.updates };
        existing.cells++;
        updatesById.set(transaction.id, existing);
      }

      const changes = Array.from(updatesById, ([id, entry]) => ({
        id,
        updates: entry.updates,
      }));
      const updatedCells = Array.from(updatesById.values()).reduce(
        (total, entry) => total + entry.cells,
        0,
      );
      const updatedRows = changes.length;
      const ok =
        changes.length === 0
          ? true
          : await onEditMany(changes, {
              silent: true,
              label: "Clear transaction cells",
            });

      if (ok && updatedRows > 0) {
        successToast(
          `Cleared ${updatedCells} cell(s) across ${updatedRows} row(s).`,
        );
      }
      if (!ok) {
        toast.warning("1 row update(s) failed.");
      }
    },
    [onEditMany, parseHistoryCellValue, successToast, transactions],
  );

  const fillSelectedHistoryCells = useCallback(
    async (value: string, selectedCells: CellCoord[]) => {
      const updatesById = new Map<
        string,
        { updates: UpdateTransactionData; cells: number }
      >();
      let skipped = 0;

      for (const cell of selectedCells) {
        const transaction = transactions[cell.row];
        const field = historyTransactionCellFields[cell.col];
        if (!transaction || !field) continue;

        const existing = updatesById.get(transaction.id) ?? {
          updates: {},
          cells: 0,
        };
        const draftKind = existing.updates.kind ?? transaction.kind;
        const result = parseHistoryCellValue(
          field,
          value,
          transaction,
          "paste",
          draftKind,
        );
        if (!result.applied) {
          skipped++;
          continue;
        }
        existing.updates = { ...existing.updates, ...result.updates };
        existing.cells++;
        updatesById.set(transaction.id, existing);
      }

      const changes = Array.from(updatesById, ([id, entry]) => ({
        id,
        updates: entry.updates,
      }));
      const updatedCells = Array.from(updatesById.values()).reduce(
        (total, entry) => total + entry.cells,
        0,
      );
      const updatedRows = changes.length;
      const ok =
        changes.length === 0
          ? true
          : await onEditMany(changes, {
              silent: true,
              label: "Fill transaction cells",
            });

      if (ok && updatedRows > 0) {
        successToast(
          `Filled ${updatedCells} cell(s) across ${updatedRows} row(s).`,
        );
      }
      if (skipped > 0 || !ok) {
        toast.warning(
          `Skipped ${skipped} invalid cell(s); ${ok ? 0 : 1} row update(s) failed.`,
        );
      }
    },
    [onEditMany, parseHistoryCellValue, successToast, transactions],
  );

  const handleHistoryCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (isNativeEditableTarget(event.target)) return;
      if (writeHistorySelectionToClipboard(event)) markCopiedRanges();
    },
    [markCopiedRanges, writeHistorySelectionToClipboard],
  );

  const handleHistoryCut = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (isNativeEditableTarget(event.target)) return;
      if (!writeHistorySelectionToClipboard(event)) return;
      clearCopiedRanges();
      void clearSelectedHistoryCells(expandSelectedCells());
    },
    [
      clearCopiedRanges,
      clearSelectedHistoryCells,
      expandSelectedCells,
      writeHistorySelectionToClipboard,
    ],
  );

  const handleHistoryPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      if (isNativeEditableTarget(event.target)) return;

      const matrix = parseClipboardMatrix(
        event.clipboardData.getData("text/plain"),
      );
      const selectedCells = expandSelectedCells();
      if (selectedCells.length === 0) return;

      if (isSingleCellMatrix(matrix) && selectedCells.length > 1) {
        event.preventDefault();
        void fillSelectedHistoryCells(matrix[0]?.[0] ?? "", selectedCells);
        clearCopiedRanges();
        return;
      }

      const startCell = topLeftCell(selectedCells);
      if (!startCell) return;
      event.preventDefault();
      void applyHistoryClipboardMatrix(
        matrix,
        startCell.row,
        startCell.col,
        "paste",
      );
      clearCopiedRanges();
    },
    [
      applyHistoryClipboardMatrix,
      clearCopiedRanges,
      expandSelectedCells,
      fillSelectedHistoryCells,
    ],
  );

  const isSpreadsheetArrowKey = (
    key: string,
  ): key is SpreadsheetArrowKey =>
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight";

  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (editingId !== null) return;
      if (isNativeEditableTarget(event.target)) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        const selectedCells = expandSelectedCells();
        if (selectedCells.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        clearCopiedRanges();
        void clearSelectedHistoryCells(selectedCells);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSelectedRanges([]);
        setAnchorCell(null);
        setActiveCell(null);
        clearCopiedRanges();
        return;
      }

      if (
        isSpreadsheetArrowKey(event.key) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const currentCell =
          activeCell ?? topLeftCell(expandSelectedCells()) ?? { row: 0, col: 0 };
        const nextCell = moveCellWithinBounds(
          currentCell,
          event.key,
          transactions.length,
          historyTransactionCellFields.length,
        );
        if (!nextCell) return;

        event.preventDefault();
        event.stopPropagation();
        clearCopiedRanges();
        if (event.shiftKey) {
          const rangeAnchor = anchorCell ?? currentCell;
          setSelectedRanges([rectangleFrom(rangeAnchor, nextCell)]);
          setAnchorCell(rangeAnchor);
        } else {
          setSelectedRanges([rectangleFrom(nextCell, nextCell)]);
          setAnchorCell(nextCell);
        }
        setActiveCell(nextCell);
        focusHistoryGridCell(nextCell.row, nextCell.col);
        return;
      }

      if (
        event.key.toLowerCase() !== "a" ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return;
      }

      const activeElement = document.activeElement;
      const selectableCell =
        activeElement instanceof HTMLElement
          ? activeElement.closest("[data-row-index][data-col-index]")
          : null;
      if (!selectableCell || !event.currentTarget.contains(selectableCell)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (transactions.length === 0) return;
      const start = { row: 0, col: 0 };
      const end = {
        row: transactions.length - 1,
        col: historyTransactionCellFields.length - 1,
      };
      setSelectedRanges([rectangleFrom(start, end)]);
      setAnchorCell(start);
      setActiveCell(end);
      clearCopiedRanges();
    },
    [
      activeCell,
      anchorCell,
      clearCopiedRanges,
      clearSelectedHistoryCells,
      editingId,
      expandSelectedCells,
      focusHistoryGridCell,
      setActiveCell,
      setAnchorCell,
      setSelectedRanges,
      transactions.length,
    ],
  );

  const headerClass =
    "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider";
  const cellClass = "px-2 py-1.5 text-sm whitespace-nowrap";
  const renderHistoryHeader = (
    col: (typeof transactionHistoryColumns)[number],
  ) => {
    const sortable = Boolean(col.sortable);
    return (
      <th
        key={col.id}
        className={cn(
          headerClass,
          "relative",
          col.align === "right" && "text-right",
          sortable && "cursor-pointer select-none hover:text-foreground",
        )}
        style={getHeaderStyle(col.id)}
        onClick={sortable ? () => onSort(col.id) : undefined}
      >
        {col.id === "select" ? (
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            disabled={transactions.length === 0}
            onChange={toggleAll}
            aria-label="Select all transactions"
          />
        ) : (
          <>
            {col.label}
            {sortable && (
              <SortIcon
                column={col.id}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
              />
            )}
          </>
        )}
        <span
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
          {...getResizeHandleProps(col.id)}
        />
      </th>
    );
  };

  return (
    <>
      <div
        ref={tableContainerRef}
        className="overflow-x-auto border border-border rounded-md"
        tabIndex={0}
        onCopy={handleHistoryCopy}
        onCut={handleHistoryCut}
        onPaste={handleHistoryPaste}
        onKeyDown={handleHistoryKeyDown}
        onFocus={() => setTableFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setTableFocused(false);
            clearCopiedRanges();
          }
        }}
      >
        <table
          className="w-full"
          style={{ minWidth: totalWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={getColStyle(column.id)} />
            ))}
          </colgroup>
          <thead className="bg-secondary/50">
            <tr>{transactionHistoryColumns.map(renderHistoryHeader)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {transactions.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className="px-2 py-8 text-center text-sm text-muted-foreground"
                >
                  No transactions found.
                </td>
              </tr>
            )}
            {transactions.map((t, rowIndex) => {
              const isEditing = editingId === t.id;
              const flaggedWords = findMatches(t.name);
              const isFlagged = flaggedWords.length > 0;
              const openSuspectFindings =
                suspectFindingsByTransaction.get(t.id) ?? [];
              const topSuspectSeverity = openSuspectFindings.some(
                (finding) => finding.severity === "high",
              )
                ? "high"
                : openSuspectFindings.some(
                      (finding) => finding.severity === "medium",
                    )
                  ? "medium"
                  : openSuspectFindings.length > 0
                    ? "low"
                    : null;
              const amountScaleValue = transactionAmountScaleValue(
                t.amount,
                t.kind,
              );
              const amountGradientStyle =
                amountScaleValue == null
                  ? undefined
                  : getGradientStyle(amountScaleValue);
              return (
                <TransactionHistoryRow
                  key={t.id}
                  ref={(node) => {
                    if (node) {
                      rowRefs.current.set(t.id, node);
                    } else {
                      rowRefs.current.delete(t.id);
                    }
                  }}
                  selected={selectedIds.has(t.id)}
                  focused={focusedId === t.id}
                  flagged={isFlagged}
                  suspectSeverity={topSuspectSeverity}
                  onFocus={() => setFocusedId(t.id)}
                  title={
                    openSuspectFindings.length > 0
                      ? openSuspectFindings
                          .map((finding) => finding.evidence.summary)
                          .join(" ")
                      : isFlagged
                        ? `Flagged words: ${flaggedWords.join(", ")}`
                        : undefined
                  }
                  onKeyDown={isEditing ? handleEditRowKeyDown : undefined}
                >
                  <td className={cellClass}>
                    <Checkbox
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleOne(t.id)}
                      aria-label={`Select ${t.name}`}
                    />
                  </td>
                  <td
                    data-row-index={rowIndex}
                    data-col-index={0}
                    className={getHistoryCellClassName(rowIndex, 0, cellClass)}
                    tabIndex={isEditing ? undefined : 0}
                    onFocus={() => focusHistoryCell(t.id, rowIndex, 0)}
                    onDoubleClick={(event) => {
                      if (isEditing) return;
                      if (!shouldHandleFieldEditDoubleClick(event)) return;
                      startEdit(t);
                    }}
                    {...getHistoryCellSelectionHandlers(rowIndex, 0)}
                  >
                    {isEditing ? (
                      <input
                        type="date"
                        value={editState.date}
                        onChange={(e) =>
                          setEditState({ ...editState, date: e.target.value })
                        }
                        className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground"
                      />
                    ) : (
                      format(parseISO(t.date), DISPLAY_DATE_FORMAT)
                    )}
                  </td>
                  <td className={cn(cellClass, "text-xs")}>
                    <EntityLabel
                      id={t.account_id}
                      name={t.account_name}
                      color={t.account_color}
                    />
                  </td>
                  <td
                    data-row-index={rowIndex}
                    data-col-index={1}
                    className={getHistoryCellClassName(rowIndex, 1, cellClass)}
                    tabIndex={isEditing ? undefined : 0}
                    onFocus={() => focusHistoryCell(t.id, rowIndex, 1)}
                    onDoubleClick={(event) => {
                      if (isEditing) return;
                      if (!shouldHandleFieldEditDoubleClick(event)) return;
                      startEdit(t);
                    }}
                    {...getHistoryCellSelectionHandlers(rowIndex, 1)}
                  >
                    {isEditing ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={editState.name}
                          onChange={(e) =>
                            setEditState({ ...editState, name: e.target.value })
                          }
                          className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground"
                        />
                        <input
                          type="text"
                          value={editState.comment}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              comment: e.target.value,
                            })
                          }
                          placeholder="Comment..."
                          className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-muted-foreground"
                        />
                      </div>
                    ) : (
                      <div>
                        <span className="inline-flex items-center gap-1">
                          {openSuspectFindings.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium uppercase text-amber-200">
                              <AlertTriangle className="h-3 w-3" />
                              {topSuspectSeverity}
                            </span>
                          )}
                          <span>{t.name}</span>
                        </span>
                        <span
                          data-row-index={rowIndex}
                          data-col-index={6}
                          aria-label={
                            t.comment ? undefined : "Empty comment cell"
                          }
                          className={getHistoryCellClassName(
                            rowIndex,
                            6,
                            "mt-0.5 block min-h-4 max-w-[200px] truncate text-xs text-muted-foreground",
                          )}
                          tabIndex={0}
                          onFocus={() => focusHistoryCell(t.id, rowIndex, 6)}
                          {...getHistoryCellSelectionHandlers(rowIndex, 6)}
                        >
                          {t.comment ?? ""}
                        </span>
                      </div>
                    )}
                  </td>
                  <td
                    data-row-index={rowIndex}
                    data-col-index={2}
                    className={getHistoryCellClassName(
                      rowIndex,
                      2,
                      cn(cellClass, "text-right font-mono tabular-nums"),
                    )}
                    tabIndex={isEditing ? undefined : 0}
                    onFocus={() => focusHistoryCell(t.id, rowIndex, 2)}
                    onDoubleClick={(event) => {
                      if (isEditing) return;
                      if (!shouldHandleFieldEditDoubleClick(event)) return;
                      startEdit(t);
                    }}
                    {...getHistoryCellSelectionHandlers(rowIndex, 2)}
                  >
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editState.amount}
                        onChange={(e) =>
                          setEditState({ ...editState, amount: e.target.value })
                        }
                        className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground"
                      />
                    ) : (
                      <span
                        className={
                          amountScaleValue == null
                            ? "text-muted-foreground"
                            : scaleValueColorClass(amountScaleValue)
                        }
                        style={amountGradientStyle}
                      >
                        {formatCurrency(t.amount)}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      cellClass,
                      "text-right font-mono tabular-nums",
                    )}
                  >
                    {formatCurrency(t.running_balance ?? 0)}
                  </td>
                  <td className={cn(cellClass, "text-xs")}>
                    <EntityLabel
                      id={t.category_id}
                      name={t.category_name}
                      color={t.category_color}
                    />
                  </td>
                  <td
                    data-row-index={rowIndex}
                    data-col-index={3}
                    className={getHistoryCellClassName(
                      rowIndex,
                      3,
                      cn(cellClass, "text-xs"),
                    )}
                    tabIndex={isEditing ? undefined : 0}
                    onFocus={() => focusHistoryCell(t.id, rowIndex, 3)}
                    onDoubleClick={(event) => {
                      if (isEditing) return;
                      if (!shouldHandleFieldEditDoubleClick(event)) return;
                      startEdit(t);
                    }}
                    {...getHistoryCellSelectionHandlers(rowIndex, 3)}
                  >
                    {isEditing ? (
                      <select
                        value={editState.kind}
                        onChange={(e) =>
                          setEditState({
                            ...editState,
                            kind: e.target.value as TransactionKind,
                            subcategory_id:
                              e.target.value === "transfer" ||
                              e.target.value === "adjustment"
                                ? ""
                                : editState.subcategory_id,
                          })
                        }
                        className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground"
                      >
                        <option value="income">Income</option>
                        <option value="expense">Expense</option>
                        <option value="transfer">Transfer</option>
                        <option value="adjustment">Adjustment</option>
                      </select>
                    ) : (
                      <span className="capitalize text-muted-foreground">
                        {t.kind}
                      </span>
                    )}
                  </td>
                  <td
                    data-row-index={rowIndex}
                    data-col-index={4}
                    className={getHistoryCellClassName(rowIndex, 4, cellClass)}
                    tabIndex={isEditing ? undefined : 0}
                    onFocus={() => focusHistoryCell(t.id, rowIndex, 4)}
                    onPaste={(e) => void applySubcategoryPaste(e, t)}
                    onDoubleClick={(event) => {
                      if (isEditing) return;
                      if (!shouldHandleFieldEditDoubleClick(event)) return;
                      startEdit(t);
                    }}
                    title="Paste a copied subcategory here to apply it to this row or selected rows"
                    {...getHistoryCellSelectionHandlers(rowIndex, 4)}
                  >
                    {isEditing ? (
                      <select
                        value={editState.subcategory_id}
                        onChange={(e) =>
                          setEditState({
                            ...editState,
                            subcategory_id: e.target.value,
                          })
                        }
                        onPaste={(e) => void applySubcategoryPaste(e, t)}
                        disabled={!kindHasSubcategory(editState.kind)}
                        className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground"
                      >
                        <option value="">None</option>
                        {subcategories.map((s) => (
                          <option key={s.id} value={s.id}>
                            {formatSubcategoryLabel(s, categoryLookup)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs">
                        <EntityLabel
                          id={t.subcategory_id}
                          name={formatNullableSubcategoryLabel(
                            t.subcategory_name,
                            t.category_type,
                          )}
                          color={t.subcategory_color}
                        />
                      </span>
                    )}
                  </td>
                  <td
                    data-row-index={rowIndex}
                    data-col-index={5}
                    className={getHistoryCellClassName(rowIndex, 5, cellClass)}
                    tabIndex={isEditing ? undefined : 0}
                    onFocus={() => focusHistoryCell(t.id, rowIndex, 5)}
                    onDoubleClick={(event) => {
                      if (isEditing) return;
                      if (!shouldHandleFieldEditDoubleClick(event)) return;
                      startEdit(t);
                    }}
                    {...getHistoryCellSelectionHandlers(rowIndex, 5)}
                  >
                    {isEditing ? (
                      <TagPicker
                        value={editState.tag_ids}
                        onChange={(tagIds) =>
                          setEditState({ ...editState, tag_ids: tagIds })
                        }
                        tags={tags}
                        onCreateTag={onCreateTag}
                        placeholder="Tags"
                        className="w-full"
                      />
                    ) : t.tags.length > 0 ? (
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {t.tags.map((tag) => (
                          <TagChip key={tag.id} tag={tag} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className={cellClass}>
                    {isEditing ? (
                      <TransactionEditRow
                        saving={saving}
                        onSave={() => void saveEdit()}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <div className="flex gap-1">
                        <button
                          onClick={() => startEdit(t)}
                          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(t)}
                          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </TransactionHistoryRow>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Transaction"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}" (${formatCurrency(deleteTarget.amount)})?`
            : ""
        }
        isLoading={deleting}
      />
    </>
  );
}
