import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent } from "react";
import type {
  CreateTagData,
  SuspectTransactionFinding,
  TransactionKind,
  TransactionWithDetails,
  Subcategory,
  Tag,
  UpdateTransactionData,
} from "@/types";
import { format, parseISO } from "date-fns";
import {
  Pencil,
  Trash2,
  Check,
  X,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDeleteModal } from "@/components/features/ConfirmDeleteModal";
import { TagChip, TagPicker } from "@/components/features/TagPicker";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { formatCurrency, cn } from "@/lib/utils";
import { DISPLAY_DATE_FORMAT } from "@/config/constants";
import {
  buildCategoryLookup,
  formatSubcategoryLabel,
  formatNullableSubcategoryLabel,
} from "@/lib/categoryLabels";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";
import { useShortcut, useShortcutScope } from "@/features/shortcuts/hooks";
import { useAmountGradient } from "@/features/display-settings/hooks";
import { useFlaggedWords } from "@/features/flagged-words/hooks";
import type { Category } from "@/types";
import { useResizableColumns } from "@/features/table-layout/useResizableColumns";
import type { ResizableColumnDef } from "@/features/table-layout/useResizableColumns";
import {
  formatClipboardMatrix,
  isCellInRanges,
  parseClipboardMatrix,
  rectangleFrom,
  selectionBoundingRange,
} from "@/features/spreadsheet-selection/selection";
import type { CellCoord, CellRange } from "@/features/spreadsheet-selection/selection";
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

interface TransactionTableProps {
  transactions: TransactionWithDetails[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  onEdit: (id: string, updates: UpdateTransactionData, options?: { silent?: boolean }) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  categories: Category[];
  subcategories: Subcategory[];
  tags: Tag[];
  onCreateTag: (data: CreateTagData) => Promise<Tag>;
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


function SortIcon({
  column,
  sortColumn,
  sortDirection,
}: {
  column: string;
  sortColumn: string;
  sortDirection: "asc" | "desc";
}) {
  if (column !== sortColumn) return null;
  return sortDirection === "asc" ? (
    <ArrowUp className="inline h-3 w-3 ml-0.5" />
  ) : (
    <ArrowDown className="inline h-3 w-3 ml-0.5" />
  );
}

const transactionHistoryColumns = [
  { id: "select", label: "", defaultWidth: 48 },
  { id: "date", label: "Date", defaultWidth: 128, sortable: true },
  { id: "account", label: "Account", defaultWidth: 160 },
  { id: "name", label: "Name", defaultWidth: 220, sortable: true },
  { id: "amount", label: "Amount", defaultWidth: 112, sortable: true, align: "right" },
  { id: "balance", label: "Balance", defaultWidth: 112, sortable: true, align: "right" },
  { id: "category", label: "Category", defaultWidth: 160 },
  { id: "kind", label: "Type", defaultWidth: 112 },
  { id: "subcategory", label: "Subcategory", defaultWidth: 180 },
  { id: "tags", label: "Tags", defaultWidth: 200 },
  { id: "actions", label: "Actions", defaultWidth: 96 },
] satisfies readonly (ResizableColumnDef & {
  label: string;
  sortable?: boolean;
  align?: "right";
})[];

export function TransactionTable({
  transactions,
  selectedIds,
  onSelectionChange,
  sortColumn,
  sortDirection,
  onSort,
  onEdit,
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
  const [selectedRanges, setSelectedRanges] = useState<CellRange[]>([]);
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [dragSelection, setDragSelection] = useState<{
    anchor: CellCoord;
    additive: boolean;
  } | null>(null);
  const dragUserSelectRef = useRef<string | null>(null);
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
  const focusedTransaction =
    transactions.find((transaction) => transaction.id === focusedId) ??
    transactions[0] ??
    null;

  useShortcutScope(
    "transactionHistoryTable",
    tableFocused || editingId !== null,
  );
  useShortcutScope("transactionHistoryEdit", editingId !== null);

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

    for (const update of updates) {
      if (!update.subcategoryId) continue;
      await onEdit(update.item.id, { subcategory_id: update.subcategoryId });
    }
  };

  useEffect(() => {
    if (!dragSelection) return;
    if (dragUserSelectRef.current === null) {
      dragUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
    }

    const stopDrag = () => setDragSelection(null);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
    return () => {
      document.removeEventListener("pointerup", stopDrag);
      document.removeEventListener("pointercancel", stopDrag);
      if (dragUserSelectRef.current !== null) {
        document.body.style.userSelect = dragUserSelectRef.current;
        dragUserSelectRef.current = null;
      }
    };
  }, [dragSelection]);

  const expandSelectedCells = useCallback((): CellCoord[] => {
    const cells: CellCoord[] = [];
    for (let row = 0; row < transactions.length; row++) {
      for (let col = 0; col < historyTransactionCellFields.length; col++) {
        const cell = { row, col };
        if (isCellInRanges(cell, selectedRanges)) cells.push(cell);
      }
    }
    return cells;
  }, [selectedRanges, transactions.length]);

  const selectHistoryCell = useCallback((cell: CellCoord) => {
    setSelectedRanges([rectangleFrom(cell, cell)]);
    setAnchorCell(cell);
    setActiveCell(cell);
  }, []);

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
      setSelectedRanges(cells.map((selectedCell) => rectangleFrom(selectedCell, selectedCell)));
      setAnchorCell(cell);
      setActiveCell(cell);
    },
    [expandSelectedCells, selectedRanges],
  );

  const getHistoryCellSelectionHandlers = useCallback(
    (rowIndex: number, colIndex: number) => ({
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const cell = { row: rowIndex, col: colIndex };
        const additive = event.ctrlKey || event.metaKey;
        const interactive =
          event.target instanceof HTMLElement &&
          ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName);

        if (event.shiftKey) {
          const anchor = anchorCell ?? activeCell ?? cell;
          setSelectedRanges([rectangleFrom(anchor, cell)]);
          setActiveCell(cell);
        } else if (additive) {
          toggleHistoryCell(cell);
        } else {
          selectHistoryCell(cell);
        }

        if (!interactive) {
          event.preventDefault();
          dragBaseRangesRef.current = additive ? selectedRanges : [];
          setDragSelection({ anchor: cell, additive });
        }
      },
      onPointerEnter: () => {
        if (!dragSelection) return;
        const focus = { row: rowIndex, col: colIndex };
        const range = rectangleFrom(dragSelection.anchor, focus);
        setSelectedRanges(
          dragSelection.additive ? [...dragBaseRangesRef.current, range] : [range],
        );
        setActiveCell(focus);
      },
    }),
    [
      activeCell,
      anchorCell,
      dragSelection,
      selectHistoryCell,
      selectedRanges,
      toggleHistoryCell,
    ],
  );

  const focusHistoryCell = useCallback(
    (transactionId: string, rowIndex: number, colIndex: number) => {
      setFocusedId(transactionId);
      const cell = { row: rowIndex, col: colIndex };
      setActiveCell(cell);
      if (!isCellInRanges(cell, selectedRanges)) {
        setSelectedRanges([rectangleFrom(cell, cell)]);
        setAnchorCell(cell);
      }
    },
    [selectedRanges],
  );

  const getHistoryCellClassName = useCallback(
    (rowIndex: number, colIndex: number, className?: string) => {
      const cell = { row: rowIndex, col: colIndex };
      const selected = isCellInRanges(cell, selectedRanges);
      const active = activeCell?.row === rowIndex && activeCell.col === colIndex;
      return cn(
        className,
        selected && "bg-ring/15 outline outline-1 outline-ring",
        active && "outline-2",
      );
    },
    [activeCell, selectedRanges],
  );

  const getHistoryCellDisplayValue = useCallback(
    (
      transaction: TransactionWithDetails,
      field: HistoryTransactionCellField,
    ): string => {
      if (field === "date") return format(parseISO(transaction.date), DISPLAY_DATE_FORMAT);
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
      if (field === "tag_ids") return transaction.tags.map((tag) => tag.name).join(", ");
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
        if (field === "subcategory_id") return { updates: { subcategory_id: null }, applied: true };
        if (field === "tag_ids") return { updates: { tag_ids: [] }, applied: true };
        if (field === "comment") return { updates: { comment: null }, applied: true };
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
            subcategory_id: kindHasSubcategory(kind) ? transaction.subcategory_id : null,
          },
          applied: true,
        };
      }
      if (field === "subcategory_id") {
        if (!kindHasSubcategory(draftKind)) return { updates: {}, applied: false };
        const subcategoryId = resolveSubcategoryId(value, categories, subcategories);
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
      for (let rowIndex = bounds.startRow; rowIndex <= bounds.endRow; rowIndex++) {
        const transaction = transactions[rowIndex];
        const values: string[] = [];
        for (let colIndex = bounds.startCol; colIndex <= bounds.endCol; colIndex++) {
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

      let updatedRows = 0;
      let updatedCells = 0;
      let failedRows = 0;
      for (const [id, entry] of updatesById) {
        const ok = await onEdit(id, entry.updates, { silent: true });
        if (ok) {
          updatedRows++;
          updatedCells += entry.cells;
        } else {
          failedRows++;
        }
      }

      if (updatedRows > 0) {
        toast.success(`Updated ${updatedCells} cell(s) across ${updatedRows} row(s).`);
      }
      if (skipped > 0 || failedRows > 0) {
        toast.warning(
          `Skipped ${skipped} invalid cell(s); ${failedRows} row update(s) failed.`,
        );
      }
    },
    [onEdit, parseHistoryCellValue, transactions],
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

      let updatedRows = 0;
      let updatedCells = 0;
      let failedRows = 0;
      for (const [id, entry] of updatesById) {
        const ok = await onEdit(id, entry.updates, { silent: true });
        if (ok) {
          updatedRows++;
          updatedCells += entry.cells;
        } else {
          failedRows++;
        }
      }

      if (updatedRows > 0) {
        toast.success(`Cleared ${updatedCells} cell(s) across ${updatedRows} row(s).`);
      }
      if (failedRows > 0) {
        toast.warning(`${failedRows} row update(s) failed.`);
      }
    },
    [onEdit, parseHistoryCellValue, transactions],
  );

  const handleHistoryCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      writeHistorySelectionToClipboard(event);
    },
    [writeHistorySelectionToClipboard],
  );

  const handleHistoryCut = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (!writeHistorySelectionToClipboard(event)) return;
      void clearSelectedHistoryCells(expandSelectedCells());
    },
    [
      clearSelectedHistoryCells,
      expandSelectedCells,
      writeHistorySelectionToClipboard,
    ],
  );

  const handleHistoryPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const selectedCells = expandSelectedCells();
      if (selectedCells.length === 0) return;

      const startCell = selectedCells.reduce((best, cell) =>
        cell.row < best.row || (cell.row === best.row && cell.col < best.col)
          ? cell
          : best,
      );
      event.preventDefault();
      void applyHistoryClipboardMatrix(
        parseClipboardMatrix(event.clipboardData.getData("text/plain")),
        startCell.row,
        startCell.col,
        "paste",
      );
    },
    [applyHistoryClipboardMatrix, expandSelectedCells],
  );

  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key.toLowerCase() !== "a" || (!event.ctrlKey && !event.metaKey)) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const selectableCell =
        activeElement instanceof HTMLElement
          ? activeElement.closest("[data-row-index][data-col-index]")
          : null;
      if (!selectableCell || !event.currentTarget.contains(selectableCell)) {
        return;
      }

      event.preventDefault();
      if (transactions.length === 0) return;
      const start = { row: 0, col: 0 };
      const end = {
        row: transactions.length - 1,
        col: historyTransactionCellFields.length - 1,
      };
      setSelectedRanges([rectangleFrom(start, end)]);
      setAnchorCell(start);
      setActiveCell(end);
    },
    [transactions.length],
  );

  const headerClass =
    "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider";
  const cellClass = "px-2 py-1.5 text-sm whitespace-nowrap";
  const renderHistoryHeader = (col: (typeof transactionHistoryColumns)[number]) => {
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
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="rounded border-border"
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
                <tr
                  key={t.id}
                  ref={(node) => {
                    if (node) {
                      rowRefs.current.set(t.id, node);
                    } else {
                      rowRefs.current.delete(t.id);
                    }
                  }}
                  tabIndex={0}
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
                  className={cn(
                    "outline-none hover:bg-secondary/30 focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring",
                    selectedIds.has(t.id) && "bg-secondary/20",
                    focusedId === t.id && "bg-secondary/30",
                    topSuspectSeverity === "low" &&
                      "bg-amber-500/10 hover:bg-amber-500/15 focus-visible:bg-amber-500/15",
                    topSuspectSeverity === "medium" &&
                      "bg-amber-500/20 hover:bg-amber-500/25 focus-visible:bg-amber-500/25",
                    topSuspectSeverity === "high" &&
                      "bg-red-500/25 hover:bg-red-500/30 focus-visible:bg-red-500/30",
                    isFlagged &&
                      "bg-red-500/25 hover:bg-red-500/30 focus-visible:bg-red-500/30",
                  )}
                >
                  <td className={cellClass}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleOne(t.id)}
                      className="rounded border-border"
                    />
                  </td>
                  <td
                    data-row-index={rowIndex}
                    data-col-index={0}
                    className={getHistoryCellClassName(rowIndex, 0, cellClass)}
                    tabIndex={isEditing ? undefined : 0}
                    onFocus={() => focusHistoryCell(t.id, rowIndex, 0)}
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
                          aria-label={t.comment ? undefined : "Empty comment cell"}
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
                    className={getHistoryCellClassName(rowIndex, 3, cn(cellClass, "text-xs"))}
                    tabIndex={isEditing ? undefined : 0}
                    onFocus={() => focusHistoryCell(t.id, rowIndex, 3)}
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
                      <div className="flex gap-1">
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="p-1 rounded hover:bg-secondary text-green-400"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <ShortcutHint commandId="transactionHistory.saveEdit" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="p-1 rounded hover:bg-secondary text-muted-foreground"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                          <ShortcutHint commandId="transactionHistory.cancelEdit" />
                        </button>
                      </div>
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
                </tr>
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
