import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type {
  ClipboardEvent,
  ChangeEvent,
  KeyboardEvent,
  PointerEvent,
} from "react";
import { format, isValid, parse } from "date-fns";
import {
  X,
  AlertTriangle,
  Plus,
  Trash2,
  Save,
  Sparkles,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useAccounts } from "@/hooks/useAccounts";
import { useAI } from "@/hooks/useAI";
import { useCategories } from "@/hooks/useCategories";
import { useTransactions } from "@/hooks/useTransactions";
import { useTags } from "@/hooks/useTags";
import { TagPicker } from "@/components/features/TagPicker";
import type { TagPickerCreateOptions } from "@/components/features/TagPicker";
import { cn, formatDateInput } from "@/lib/utils";
import { normalizeTransactionAmount } from "@/lib/transactionAmounts";
import type {
  AccountType,
  Category,
  CreateTagData,
  Subcategory,
  Tag,
  CreateTransactionData,
  TransactionKind,
} from "@/types";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";
import { useShortcut, useShortcutScope } from "@/features/shortcuts/hooks";
import { useSuccessToast } from "@/features/display-settings/hooks";
import { useUndoRedo } from "@/features/undo-redo/hooks";
import { useFlaggedWords } from "@/features/flagged-words/hooks";
import type { FlaggedWordMatch } from "@/features/flagged-words/storage";
import { useResizableColumns } from "@/features/table-layout/useResizableColumns";
import type { ResizableColumnDef } from "@/features/table-layout/useResizableColumns";
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
  hasSelectedInputText,
  isNativeEditableTarget,
} from "@/features/spreadsheet-selection/domTargets";
import {
  addTransactionCellFields,
  kindHasSubcategory,
  parsePastedAmount,
  parsePastedDate,
  resolveAccountId,
  resolveKind,
  resolveSubcategoryId,
  resolveTagIds,
} from "@/lib/transactionCellParsing";
import type { TransactionCellField } from "@/lib/transactionCellParsing";
import {
  buildCategoryLookup,
  formatCategoryLabel,
  formatSubcategoryLabel,
} from "@/lib/categoryLabels";
import { handleEnterSave } from "@/lib/enterSave";

// ── Row type ──────────────────────────────────────────────────────────

interface TransactionRow {
  id: string;
  date: string;
  name: string;
  amount: string;
  kind: TransactionKind;
  account_id: string;
  subcategory_id: string;
  tag_ids: string[];
  comment: string;
  isDuplicate: boolean;
  transferMatch: unknown | null;
  categorizationSource: "lookup" | "transfer" | "ai" | "none" | "manual";
  aiSuggestedSubcategoryId: string | null;
}

interface DraftSnapshot {
  rows: TransactionRow[];
  duplicatesChecked: boolean;
  parseSummary: string | null;
  statementText: string;
  statementAccountId: string;
}

function emptyRow(): TransactionRow {
  return {
    id: crypto.randomUUID(),
    date: "",
    name: "",
    amount: "",
    kind: "expense",
    account_id: "",
    subcategory_id: "",
    tag_ids: [],
    comment: "",
    isDuplicate: false,
    transferMatch: null,
    categorizationSource: "manual",
    aiSuggestedSubcategoryId: null,
  };
}

function initialRows(count = 5): TransactionRow[] {
  return Array.from({ length: count }, () => emptyRow());
}

function cloneRows(rows: TransactionRow[]): TransactionRow[] {
  return rows.map((row) => ({ ...row, tag_ids: [...row.tag_ids] }));
}

// ── Helpers ───────────────────────────────────────────────────────────

function isRowFilled(row: TransactionRow) {
  return row.date || row.name || row.amount || row.account_id;
}

function isRowValid(row: TransactionRow) {
  return row.date && row.name && row.amount && row.account_id;
}

function parseDisplayDate(displayDate: string): Date | null {
  const parsed = parse(displayDate, "MM/dd/yyyy", new Date());
  return isValid(parsed) && format(parsed, "MM/dd/yyyy") === displayDate
    ? parsed
    : null;
}

function displayAmountToNumber(val: string): number {
  const cleaned = val.replace(/[$,\s]/g, "");
  return parseFloat(cleaned) || 0;
}

function formatAmountDisplay(
  val: string,
  accountType?: AccountType,
  kind: TransactionKind = "expense",
): string {
  const num = accountType
    ? normalizeTransactionAmount(displayAmountToNumber(val), accountType, kind)
    : displayAmountToNumber(val);
  if (!num && val === "") return "";
  const negative = num < 0;
  const abs = Math.abs(num).toFixed(2);
  return negative ? `-${abs}` : abs;
}

function toApiDate(displayDate: string): string {
  const parsed = parseDisplayDate(displayDate);
  if (!parsed) {
    throw new Error("Invalid transaction date.");
  }
  return format(parsed, "yyyy-MM-dd");
}

function getAccountType(
  accountId: string,
  accounts: { id: string; type: AccountType }[],
): AccountType | undefined {
  return accounts.find((account) => account.id === accountId)?.type;
}

function normalizeRowAmountDisplay(
  row: TransactionRow,
  accounts: { id: string; type: AccountType }[],
): string {
  return formatAmountDisplay(
    row.amount,
    getAccountType(row.account_id, accounts),
    row.kind,
  );
}

type CellApplyMode = "paste" | "clear";

interface CellApplyResult {
  row: TransactionRow;
  applied: boolean;
}

function applyCellValue(
  row: TransactionRow,
  field: TransactionCellField,
  value: string,
  accounts: { id: string; name: string; type: AccountType }[],
  categories: Category[],
  subcategories: Subcategory[],
  tags: Tag[],
  mode: CellApplyMode,
): CellApplyResult {
  if (mode === "clear") {
    if (field === "kind") return { row, applied: false };
    if (field === "date")
      return { row: { ...row, date: "" }, applied: row.date !== "" };
    if (field === "name")
      return { row: { ...row, name: "" }, applied: row.name !== "" };
    if (field === "amount")
      return { row: { ...row, amount: "" }, applied: row.amount !== "" };
    if (field === "account_id") {
      return {
        row: { ...row, account_id: "" },
        applied: row.account_id !== "",
      };
    }
    if (field === "subcategory_id") {
      return {
        row: {
          ...row,
          subcategory_id: "",
          categorizationSource:
            row.categorizationSource === "ai"
              ? "manual"
              : row.categorizationSource,
        },
        applied: row.subcategory_id !== "",
      };
    }
    if (field === "tag_ids") {
      return { row: { ...row, tag_ids: [] }, applied: row.tag_ids.length > 0 };
    }
    return { row: { ...row, comment: "" }, applied: row.comment !== "" };
  }

  if (field === "date") {
    const parsedDate = parsePastedDate(value);
    return parsedDate
      ? { row: { ...row, date: parsedDate.displayDate }, applied: true }
      : { row, applied: false };
  }

  if (field === "name") {
    const name = value.trim();
    return name
      ? { row: { ...row, name }, applied: true }
      : { row, applied: false };
  }

  if (field === "amount") {
    const amount = parsePastedAmount(value);
    return amount === null
      ? { row, applied: false }
      : {
          row: {
            ...row,
            amount: formatAmountDisplay(
              String(amount),
              getAccountType(row.account_id, accounts),
              row.kind,
            ),
          },
          applied: true,
        };
  }

  if (field === "kind") {
    const kind = resolveKind(value);
    return kind
      ? {
          row: {
            ...row,
            kind,
            amount: formatAmountDisplay(
              row.amount,
              getAccountType(row.account_id, accounts),
              kind,
            ),
            subcategory_id: kindHasSubcategory(kind) ? row.subcategory_id : "",
          },
          applied: true,
        }
      : { row, applied: false };
  }

  if (field === "comment") {
    return { row: { ...row, comment: value }, applied: true };
  }

  if (field === "account_id") {
    const accountId = resolveAccountId(value, accounts);
    return accountId
      ? {
          row: {
            ...row,
            account_id: accountId,
            amount: formatAmountDisplay(
              row.amount,
              getAccountType(accountId, accounts),
              row.kind,
            ),
          },
          applied: true,
        }
      : { row, applied: false };
  }

  if (field === "tag_ids") {
    const tagIds = resolveTagIds(value, tags);
    return tagIds.length > 0
      ? { row: { ...row, tag_ids: tagIds }, applied: true }
      : { row, applied: false };
  }

  const subcategoryId = resolveSubcategoryId(value, categories, subcategories);
  return subcategoryId && kindHasSubcategory(row.kind)
    ? {
        row: {
          ...row,
          subcategory_id: subcategoryId,
          categorizationSource:
            row.categorizationSource === "ai"
              ? "manual"
              : row.categorizationSource,
        },
        applied: true,
      }
    : { row, applied: false };
}

// ── Grouped subcategory select ────────────────────────────────────────

interface GroupedSelectProps {
  value: string;
  onChange: (value: string) => void;
  categories: Category[];
  subcategories: Subcategory[];
  className?: string;
  onPaste?: (event: ClipboardEvent<HTMLSelectElement>) => void;
  onFocus?: () => void;
  refIndex?: number;
  registerRef?: (index: number, node: HTMLSelectElement | null) => void;
  disabled?: boolean;
}

function GroupedSubcategorySelect({
  value,
  onChange,
  categories,
  subcategories,
  className,
  onPaste,
  onFocus,
  refIndex,
  registerRef,
  disabled,
}: GroupedSelectProps) {
  const filtered = useMemo(() => {
    return categories
      .map((cat) => ({
        category: cat,
        subs: subcategories.filter((s) => s.category_id === cat.id),
      }))
      .filter((g) => g.subs.length > 0);
  }, [categories, subcategories]);
  const categoryLookup = useMemo(
    () => buildCategoryLookup(categories),
    [categories],
  );

  return (
    <select
      ref={(node) => {
        if (refIndex !== undefined) {
          registerRef?.(refIndex, node);
        }
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={onPaste}
      onFocus={onFocus}
      disabled={disabled}
      className={cn(
        "h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <option value="">--</option>
      {filtered.map((group) => (
        <optgroup
          key={group.category.id}
          label={formatCategoryLabel(group.category)}
        >
          {group.subs.map((sub) => (
            <option key={sub.id} value={sub.id}>
              {formatSubcategoryLabel(sub, categoryLookup)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const manualTransactionColumns: readonly ResizableColumnDef[] = [
  { id: "indicator", defaultWidth: 32 },
  { id: "date", defaultWidth: 112 },
  { id: "name", defaultWidth: 176 },
  { id: "amount", defaultWidth: 96 },
  { id: "kind", defaultWidth: 96 },
  { id: "account", defaultWidth: 128 },
  { id: "subcategory", defaultWidth: 144 },
  { id: "tags", defaultWidth: 176 },
  { id: "comment", defaultWidth: 128 },
  { id: "remove", defaultWidth: 32 },
];

// ── Main component ────────────────────────────────────────────────────

export function MultiTransactionTable() {
  const { accounts } = useAccounts();
  const { categories, subcategories } = useCategories();
  const { tags, createTag, deleteTag, restoreTag } = useTags();
  const {
    bulkCreateTransactions,
    bulkDeleteTransactions,
    bulkRestoreTransactions,
    checkDuplicates,
  } = useTransactions();
  const { categorize, parseStatement } = useAI();
  const { findTransactionMatches } = useFlaggedWords();
  const successToast = useSuccessToast();
  const { execute } = useUndoRedo();

  const [rows, setRows] = useState<TransactionRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [flaggedWarningMatches, setFlaggedWarningMatches] = useState<
    FlaggedWordMatch[]
  >([]);
  const [duplicatesChecked, setDuplicatesChecked] = useState(false);
  const [statementText, setStatementText] = useState("");
  const [statementAccountId, setStatementAccountId] = useState("");
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [parseSummary, setParseSummary] = useState<string | null>(null);
  const statementAccountRef = useRef<HTMLSelectElement>(null);
  const statementTextRef = useRef<HTMLTextAreaElement>(null);
  const cellRefs = useRef<Array<HTMLElement | null>>([]);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [gridFocused, setGridFocused] = useState(false);
  const [selectedRanges, setSelectedRanges] = useState<CellRange[]>([]);
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [editingCell, setEditingCell] = useState<CellCoord | null>(null);
  const [copiedRanges, setCopiedRanges] = useState<CellRange[]>([]);
  const copiedRangeTimeoutRef = useRef<number | null>(null);
  const [dragSelection, setDragSelection] = useState<{
    anchor: CellCoord;
    additive: boolean;
  } | null>(null);
  const dragBaseRangesRef = useRef<CellRange[]>([]);
  const pointerSelectingRef = useRef(false);
  const programmaticCellFocusRef = useRef(false);
  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns(
    "transaction-input.manual-entry",
    manualTransactionColumns,
  );

  const captureDraftSnapshot = useCallback(
    (overrides?: Partial<DraftSnapshot>): DraftSnapshot => ({
      rows: cloneRows(overrides?.rows ?? rows),
      duplicatesChecked: overrides?.duplicatesChecked ?? duplicatesChecked,
      parseSummary:
        overrides && "parseSummary" in overrides
          ? (overrides.parseSummary ?? null)
          : parseSummary,
      statementText: overrides?.statementText ?? statementText,
      statementAccountId: overrides?.statementAccountId ?? statementAccountId,
    }),
    [duplicatesChecked, parseSummary, rows, statementAccountId, statementText],
  );

  const restoreDraftSnapshot = useCallback((snapshot: DraftSnapshot) => {
    setRows(cloneRows(snapshot.rows));
    setDuplicatesChecked(snapshot.duplicatesChecked);
    setParseSummary(snapshot.parseSummary);
    setStatementText(snapshot.statementText);
    setStatementAccountId(snapshot.statementAccountId);
  }, []);

  const executeDraftSnapshotAction = useCallback(
    (
      label: string,
      before: DraftSnapshot,
      after: DraftSnapshot,
      onInitialApply?: () => void,
    ) =>
      execute({
        id: crypto.randomUUID(),
        label,
        apply: () => {
          restoreDraftSnapshot(after);
          onInitialApply?.();
        },
        undo: () => restoreDraftSnapshot(before),
        redo: () => restoreDraftSnapshot(after),
      }),
    [execute, restoreDraftSnapshot],
  );

  useShortcutScope("transactionInput");
  useShortcutScope("transactionInputGrid", gridFocused);

  const clearCopiedRanges = useCallback(() => {
    if (
      copiedRangeTimeoutRef.current !== null &&
      typeof window !== "undefined"
    ) {
      window.clearTimeout(copiedRangeTimeoutRef.current);
    }
    copiedRangeTimeoutRef.current = null;
    setCopiedRanges([]);
  }, []);

  const markCopiedRanges = useCallback(() => {
    clearCopiedRanges();
    setCopiedRanges(selectedRanges.map((range) => ({ ...range })));
    if (typeof window !== "undefined") {
      copiedRangeTimeoutRef.current = window.setTimeout(
        clearCopiedRanges,
        1200,
      );
    }
  }, [clearCopiedRanges, selectedRanges]);

  useEffect(() => clearCopiedRanges, [clearCopiedRanges]);

  // ── Row manipulation ──────────────────────────────────────────────

  const updateRow = useCallback(
    (
      id: string,
      field: keyof TransactionRow,
      value: string | boolean | string[],
    ) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, [field]: value, isDuplicate: false } : r,
        ),
      );
      setDuplicatesChecked(false);
    },
    [],
  );

  const addRow = useCallback(() => {
    const before = captureDraftSnapshot();
    const after = captureDraftSnapshot({
      rows: [...cloneRows(rows), emptyRow()],
    });
    void executeDraftSnapshotAction("Add transaction row", before, after);
  }, [captureDraftSnapshot, executeDraftSnapshotAction, rows]);

  const handleSubcategoryChange = useCallback(
    (row: TransactionRow, value: string) => {
      updateRow(row.id, "subcategory_id", value);
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                subcategory_id: value,
                categorizationSource:
                  row.categorizationSource === "ai"
                    ? "manual"
                    : r.categorizationSource,
              }
            : r,
        ),
      );
    },
    [updateRow],
  );

  const handleKindChange = useCallback(
    (row: TransactionRow, kind: TransactionKind) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                kind,
                amount: formatAmountDisplay(
                  r.amount,
                  getAccountType(r.account_id, accounts),
                  kind,
                ),
                subcategory_id: kindHasSubcategory(kind)
                  ? r.subcategory_id
                  : "",
              }
            : r,
        ),
      );
      setDuplicatesChecked(false);
    },
    [accounts],
  );

  const removeRow = useCallback(
    (id: string) => {
      const before = captureDraftSnapshot();
      const nextRows =
        rows.length <= 1 ? [emptyRow()] : rows.filter((row) => row.id !== id);
      const after = captureDraftSnapshot({
        rows: nextRows,
        duplicatesChecked: false,
      });
      void executeDraftSnapshotAction("Remove transaction row", before, after);
    },
    [captureDraftSnapshot, executeDraftSnapshotAction, rows],
  );

  const clearAll = useCallback(() => {
    const before = captureDraftSnapshot();
    const after = captureDraftSnapshot({
      rows: initialRows(),
      duplicatesChecked: false,
    });
    void executeDraftSnapshotAction("Clear transactions", before, after);
  }, [captureDraftSnapshot, executeDraftSnapshotAction]);

  const focusCell = useCallback((index: number) => {
    const cells = cellRefs.current.filter(
      (cell): cell is HTMLElement => cell !== null,
    );
    if (cells.length === 0) return;
    const nextIndex = Math.max(0, Math.min(index, cells.length - 1));
    cells[nextIndex]?.focus();
  }, []);

  const focusAdjacentCell = useCallback(
    (direction: 1 | -1) => {
      const active = document.activeElement;
      const currentIndex = cellRefs.current.findIndex(
        (cell) => cell === active,
      );
      focusCell(currentIndex >= 0 ? currentIndex + direction : 0);
    },
    [focusCell],
  );

  // ── Selection and paste handling ───────────────────────────────────

  const manualCategoryLookup = useMemo(
    () => buildCategoryLookup(categories),
    [categories],
  );

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
      if (!cellElement || !gridContainerRef.current?.contains(cellElement)) {
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
  }, [dragSelection]);

  const selectSingleCell = useCallback((cell: CellCoord) => {
    const range = rectangleFrom(cell, cell);
    setSelectedRanges([range]);
    setAnchorCell(cell);
    setActiveCell(cell);
    setEditingCell(null);
  }, []);

  const expandSelectedCells = useCallback(
    (): CellCoord[] =>
      expandRangesToCells(
        selectedRanges,
        rows.length,
        addTransactionCellFields.length,
      ),
    [rows.length, selectedRanges],
  );

  const toggleCellSelection = useCallback(
    (cell: CellCoord) => {
      if (!isCellInRanges(cell, selectedRanges)) {
        setSelectedRanges((current) => [...current, rectangleFrom(cell, cell)]);
        setAnchorCell(cell);
        setActiveCell(cell);
        setEditingCell(null);
        return;
      }

      const cells = expandSelectedCells().filter(
        (selectedCell) =>
          selectedCell.row !== cell.row || selectedCell.col !== cell.col,
      );
      setSelectedRanges(
        cells.map((selectedCell) => rectangleFrom(selectedCell, selectedCell)),
      );
      setActiveCell(cell);
      setAnchorCell(cell);
      setEditingCell(null);
    },
    [expandSelectedCells, selectedRanges],
  );

  const focusEditableCell = useCallback(
    (rowIndex: number, colIndex: number) => {
      programmaticCellFocusRef.current = true;
      cellRefs.current[
        rowIndex * addTransactionCellFields.length + colIndex
      ]?.focus();
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          programmaticCellFocusRef.current = false;
        });
      } else {
        programmaticCellFocusRef.current = false;
      }
    },
    [],
  );

  const enterCellEditMode = useCallback(
    (cell: CellCoord | null = activeCell): boolean => {
      if (!cell) return false;

      setEditingCell(cell);
      setSelectedRanges([rectangleFrom(cell, cell)]);
      setAnchorCell(cell);
      setActiveCell(cell);
      focusEditableCell(cell.row, cell.col);

      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          const target =
            cellRefs.current[
              cell.row * addTransactionCellFields.length + cell.col
            ];
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
          ) {
            const valueLength = target.value.length;
            target.setSelectionRange(valueLength, valueLength);
          }
        });
      }
      return true;
    },
    [activeCell, focusEditableCell],
  );

  const getCellSelectionHandlers = useCallback(
    (rowIndex: number, colIndex: number) => ({
      onPointerDown: (event: PointerEvent<HTMLTableCellElement>) => {
        if (event.button !== 0) return;

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
          setEditingCell(null);
        } else if (additive) {
          toggleCellSelection(cell);
        } else {
          selectSingleCell(cell);
        }

        if (!interactive) {
          event.preventDefault();
          focusEditableCell(rowIndex, colIndex);
        }
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
      onDoubleClick: () => {
        enterCellEditMode({ row: rowIndex, col: colIndex });
      },
    }),
    [
      activeCell,
      anchorCell,
      enterCellEditMode,
      focusEditableCell,
      selectSingleCell,
      selectedRanges,
      toggleCellSelection,
    ],
  );

  const handleCellFocus = useCallback(
    (rowId: string, rowIndex: number, colIndex: number) => {
      setFocusedRowId(rowId);
      if (pointerSelectingRef.current || programmaticCellFocusRef.current)
        return;
      const cell = { row: rowIndex, col: colIndex };
      setActiveCell(cell);
      if (!isCellInRanges(cell, selectedRanges)) {
        setSelectedRanges([rectangleFrom(cell, cell)]);
        setAnchorCell(cell);
        setEditingCell(null);
      }
    },
    [selectedRanges],
  );

  const getCellClassName = useCallback(
    (rowIndex: number, colIndex: number) => {
      const cell = { row: rowIndex, col: colIndex };
      const selected = isCellInRanges(cell, selectedRanges);
      const active =
        activeCell?.row === rowIndex && activeCell.col === colIndex;
      const copied = isCellInRanges(cell, copiedRanges);
      return cn(
        "px-1 py-0.5 align-top",
        selected && "bg-ring/15 outline outline-1 outline-ring",
        active && "outline-2",
        copied && "bg-primary/10 outline-dashed outline-2 outline-primary",
      );
    },
    [activeCell, copiedRanges, selectedRanges],
  );

  const getManualCellDisplayValue = useCallback(
    (row: TransactionRow, field: TransactionCellField): string => {
      if (field === "date") return row.date;
      if (field === "name") return row.name;
      if (field === "amount") return normalizeRowAmountDisplay(row, accounts);
      if (field === "kind") return row.kind;
      if (field === "account_id") {
        return (
          accounts.find((account) => account.id === row.account_id)?.name ?? ""
        );
      }
      if (field === "subcategory_id") {
        const subcategory = subcategories.find(
          (item) => item.id === row.subcategory_id,
        );
        return subcategory
          ? formatSubcategoryLabel(subcategory, manualCategoryLookup)
          : "";
      }
      if (field === "tag_ids") {
        return row.tag_ids
          .map((tagId) => tags.find((tag) => tag.id === tagId)?.name ?? "")
          .filter(Boolean)
          .join(", ");
      }
      return row.comment;
    },
    [accounts, manualCategoryLookup, subcategories, tags],
  );

  const writeSelectedCellsToClipboard = useCallback(
    (event: ClipboardEvent<HTMLElement>): boolean => {
      const bounds = selectionBoundingRange(selectedRanges);
      if (!bounds) return false;

      const matrix: string[][] = [];
      for (
        let rowIndex = bounds.startRow;
        rowIndex <= bounds.endRow;
        rowIndex++
      ) {
        const row = rows[rowIndex];
        const values: string[] = [];
        for (
          let colIndex = bounds.startCol;
          colIndex <= bounds.endCol;
          colIndex++
        ) {
          const cell = { row: rowIndex, col: colIndex };
          const field = addTransactionCellFields[colIndex];
          values.push(
            row && field && isCellInRanges(cell, selectedRanges)
              ? getManualCellDisplayValue(row, field)
              : "",
          );
        }
        matrix.push(values);
      }

      event.clipboardData.setData("text/plain", formatClipboardMatrix(matrix));
      event.preventDefault();
      return true;
    },
    [getManualCellDisplayValue, rows, selectedRanges],
  );

  const applyClipboardMatrix = useCallback(
    (
      matrix: string[][],
      startRow: number,
      startCol: number,
      mode: CellApplyMode,
    ) => {
      const next = cloneRows(rows);
      let changed = false;
      let skipped = 0;

      for (let rowOffset = 0; rowOffset < matrix.length; rowOffset++) {
        const targetRow = startRow + rowOffset;
        while (targetRow >= next.length) next.push(emptyRow());
        let row = { ...next[targetRow], tag_ids: [...next[targetRow].tag_ids] };
        let rowChanged = false;
        const values = matrix[rowOffset] ?? [];
        for (let colOffset = 0; colOffset < values.length; colOffset++) {
          const field = addTransactionCellFields[startCol + colOffset];
          if (!field) break;
          const result = applyCellValue(
            row,
            field,
            values[colOffset] ?? "",
            accounts,
            categories,
            subcategories,
            tags,
            mode,
          );
          row = result.row;
          rowChanged ||= result.applied;
          changed ||= result.applied;
          if (!result.applied && mode === "paste") skipped++;
        }
        next[targetRow] = rowChanged ? { ...row, isDuplicate: false } : row;
      }

      if (!changed) {
        if (skipped > 0) {
          toast.warning(`Skipped ${skipped} invalid pasted cell(s).`);
        }
        return;
      }

      const before = captureDraftSnapshot();
      const after = captureDraftSnapshot({
        rows: next,
        duplicatesChecked: false,
      });
      void executeDraftSnapshotAction(
        mode === "clear"
          ? "Clear transaction cells"
          : "Paste transaction cells",
        before,
        after,
        () => {
          if (skipped > 0) {
            toast.warning(`Skipped ${skipped} invalid pasted cell(s).`);
          }
        },
      );
    },
    [
      accounts,
      captureDraftSnapshot,
      categories,
      executeDraftSnapshotAction,
      rows,
      subcategories,
      tags,
    ],
  );

  const clearSelectedManualCells = useCallback(
    (selectedCells: CellCoord[], label: string): boolean => {
      if (selectedCells.length === 0) return false;

      const next = cloneRows(rows);
      let changed = false;
      for (const cell of selectedCells) {
        const field = addTransactionCellFields[cell.col];
        const row = next[cell.row];
        if (!field || !row) continue;
        const result = applyCellValue(
          { ...row, tag_ids: [...row.tag_ids] },
          field,
          "",
          accounts,
          categories,
          subcategories,
          tags,
          "clear",
        );
        next[cell.row] = result.applied
          ? { ...result.row, isDuplicate: false }
          : result.row;
        changed ||= result.applied;
      }
      if (!changed) return false;

      const before = captureDraftSnapshot();
      const after = captureDraftSnapshot({
        rows: next,
        duplicatesChecked: false,
      });
      void executeDraftSnapshotAction(label, before, after);
      return true;
    },
    [
      accounts,
      captureDraftSnapshot,
      categories,
      executeDraftSnapshotAction,
      rows,
      subcategories,
      tags,
    ],
  );

  const fillSelectedManualCells = useCallback(
    (value: string, selectedCells: CellCoord[]) => {
      if (selectedCells.length === 0) return;

      const next = cloneRows(rows);
      let changed = false;
      let skipped = 0;

      for (const cell of selectedCells) {
        const field = addTransactionCellFields[cell.col];
        const row = next[cell.row];
        if (!field || !row) continue;
        const result = applyCellValue(
          { ...row, tag_ids: [...row.tag_ids] },
          field,
          value,
          accounts,
          categories,
          subcategories,
          tags,
          "paste",
        );
        if (!result.applied) {
          skipped++;
          continue;
        }
        next[cell.row] = { ...result.row, isDuplicate: false };
        changed = true;
      }

      if (!changed) {
        if (skipped > 0) {
          toast.warning(`Skipped ${skipped} invalid pasted cell(s).`);
        }
        return;
      }

      const before = captureDraftSnapshot();
      const after = captureDraftSnapshot({
        rows: next,
        duplicatesChecked: false,
      });
      void executeDraftSnapshotAction(
        "Fill transaction cells",
        before,
        after,
        () => {
          if (skipped > 0) {
            toast.warning(`Skipped ${skipped} invalid pasted cell(s).`);
          }
        },
      );
    },
    [
      accounts,
      captureDraftSnapshot,
      categories,
      executeDraftSnapshotAction,
      rows,
      subcategories,
      tags,
    ],
  );

  const handlePaste = useCallback(
    (
      event: ClipboardEvent<HTMLElement>,
      rowIndex: number,
      startField: TransactionCellField,
    ) => {
      if (selectedRanges.length > 0) return;

      const text = event.clipboardData.getData("text/plain");
      const isStructuredPaste = text.includes("\t") || text.includes("\n");
      const isSelectPaste =
        startField === "account_id" ||
        startField === "subcategory_id" ||
        startField === "kind" ||
        startField === "tag_ids";
      if (!isStructuredPaste && !isSelectPaste) return;

      event.preventDefault();
      const startColumn = addTransactionCellFields.indexOf(startField);
      applyClipboardMatrix(
        parseClipboardMatrix(text),
        rowIndex,
        startColumn,
        "paste",
      );
      clearCopiedRanges();
    },
    [applyClipboardMatrix, clearCopiedRanges, selectedRanges.length],
  );

  const handleGridCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (hasSelectedInputText(event.target)) return;
      if (
        isNativeEditableTarget(event.target) &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      if (writeSelectedCellsToClipboard(event)) markCopiedRanges();
    },
    [markCopiedRanges, writeSelectedCellsToClipboard],
  );

  const handleGridCut = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (hasSelectedInputText(event.target)) return;
      if (
        isNativeEditableTarget(event.target) &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      if (!writeSelectedCellsToClipboard(event)) return;
      clearCopiedRanges();
      setEditingCell(null);
      clearSelectedManualCells(expandSelectedCells(), "Cut transaction cells");
    },
    [
      clearCopiedRanges,
      clearSelectedManualCells,
      expandSelectedCells,
      writeSelectedCellsToClipboard,
    ],
  );

  const handleGridPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const text = event.clipboardData.getData("text/plain");
      const matrix = parseClipboardMatrix(text);

      if (hasSelectedInputText(event.target)) return;
      if (
        isNativeEditableTarget(event.target) &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        return;
      }

      const selectedCells = expandSelectedCells();
      if (selectedCells.length === 0) return;
      if (
        isNativeEditableTarget(event.target) &&
        !text.includes("\t") &&
        !text.includes("\n") &&
        selectedCells.length === 1
      ) {
        return;
      }

      if (isSingleCellMatrix(matrix) && selectedCells.length > 1) {
        event.preventDefault();
        fillSelectedManualCells(matrix[0]?.[0] ?? "", selectedCells);
        setEditingCell(null);
        clearCopiedRanges();
        return;
      }

      const startCell = topLeftCell(selectedCells);
      if (!startCell) return;
      event.preventDefault();
      applyClipboardMatrix(matrix, startCell.row, startCell.col, "paste");
      setEditingCell(null);
      clearCopiedRanges();
    },
    [
      applyClipboardMatrix,
      clearCopiedRanges,
      expandSelectedCells,
      fillSelectedManualCells,
    ],
  );

  const isSpreadsheetArrowKey = (
    key: string,
  ): key is SpreadsheetArrowKey =>
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight";

  const handleGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): boolean => {
      const activeEditingCell =
        editingCell &&
        activeCell &&
        editingCell.row === activeCell.row &&
        editingCell.col === activeCell.col;

      if (activeEditingCell && isNativeEditableTarget(event.target)) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setEditingCell(null);
          return true;
        }
        if (
          event.key === "Delete" ||
          event.key === "Backspace" ||
          isSpreadsheetArrowKey(event.key)
        ) {
          return false;
        }
      }

      if (
        event.key === "Enter" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        activeCell
      ) {
        event.preventDefault();
        event.stopPropagation();
        return enterCellEditMode(activeCell);
      }

      if (event.key === "F2") {
        event.preventDefault();
        event.stopPropagation();
        return enterCellEditMode(activeCell);
      }

      if (
        event.key.toLowerCase() === "a" &&
        (event.ctrlKey || event.metaKey)
      ) {
        if (!gridContainerRef.current?.contains(document.activeElement)) {
          return false;
        }

        event.preventDefault();
        event.stopPropagation();
        if (rows.length === 0) return true;
        const start = { row: 0, col: 0 };
        const end = {
          row: rows.length - 1,
          col: addTransactionCellFields.length - 1,
        };
        setSelectedRanges([rectangleFrom(start, end)]);
        setAnchorCell(start);
        setActiveCell(end);
        setEditingCell(null);
        clearCopiedRanges();
        return true;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        setEditingCell(null);
        clearCopiedRanges();
        clearSelectedManualCells(expandSelectedCells(), "Clear transaction cells");
        return true;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSelectedRanges([]);
        setAnchorCell(null);
        setActiveCell(null);
        setEditingCell(null);
        clearCopiedRanges();
        return true;
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
          rows.length,
          addTransactionCellFields.length,
        );
        if (!nextCell) return false;

        event.preventDefault();
        event.stopPropagation();
        setEditingCell(null);
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
        focusEditableCell(nextCell.row, nextCell.col);
        return true;
      }

      return false;
    },
    [
      activeCell,
      anchorCell,
      clearCopiedRanges,
      clearSelectedManualCells,
      editingCell,
      enterCellEditMode,
      expandSelectedCells,
      focusEditableCell,
      rows.length,
    ],
  );

  // ── Submit ────────────────────────────────────────────────────────

  const filledRows = useMemo(() => rows.filter(isRowFilled), [rows]);

  const handleAICategorize = useCallback(async () => {
    const eligibleRows = filledRows.filter(
      (r) => r.name && r.amount && r.account_id,
    );
    if (eligibleRows.length === 0) {
      toast.error(
        "Rows need a name, amount, and account before AI categorization.",
      );
      return;
    }

    const conversationId = crypto.randomUUID();
    setLastRunId(conversationId);

    try {
      const result = await categorize.mutateAsync({
        conversationId,
        transactions: eligibleRows.map((row) => ({
          name: row.name,
          account_id: row.account_id,
          account_name:
            accounts.find((account) => account.id === row.account_id)?.name ??
            "Unknown",
          amount: displayAmountToNumber(
            normalizeRowAmountDisplay(row, accounts),
          ),
          account_type: getAccountType(row.account_id, accounts),
          date: row.date ? toApiDate(row.date) : undefined,
        })),
      });
      const data = result.data ?? [];
      const byId = new Map(
        eligibleRows.map((row, index) => [row.id, data[index]]),
      );
      const nextRows = rows.map((row) => {
        const cat = byId.get(row.id);
        if (!cat) return row;
        return {
          ...row,
          kind: cat.kind,
          subcategory_id: kindHasSubcategory(cat.kind)
            ? (cat.subcategory_id ?? row.subcategory_id)
            : "",
          categorizationSource: cat.source,
          aiSuggestedSubcategoryId:
            cat.source === "ai" ? cat.subcategory_id : null,
        };
      });
      const before = captureDraftSnapshot();
      const after = captureDraftSnapshot({ rows: nextRows });
      await executeDraftSnapshotAction(
        "Categorize transactions",
        before,
        after,
        () => successToast(`Categorized ${data.length} row(s).`),
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "AI categorization failed.",
      );
    }
  }, [
    accounts,
    captureDraftSnapshot,
    categorize,
    executeDraftSnapshotAction,
    filledRows,
    rows,
    successToast,
  ]);

  const handleParseStatement = useCallback(async () => {
    if (!statementText.trim() || !statementAccountId) {
      toast.error("Choose an account and paste statement text first.");
      return;
    }

    try {
      const result = await parseStatement.mutateAsync({
        text: statementText,
        accountId: statementAccountId,
      });
      const data = result.data;
      if (!data) return;

      const summary = `${data.summary.total} parsed, ${data.summary.duplicates} duplicate(s), ${data.summary.uncategorized} uncategorized, ${Math.round(data.parseSuccessRate * 100)}% success`;
      const nextRows = data.transactions.map((tx) => ({
        id: crypto.randomUUID(),
        date: formatDateInput(tx.date),
        name: tx.name,
        amount: String(tx.amount.toFixed(2)),
        kind: tx.kind,
        account_id: statementAccountId,
        subcategory_id: tx.subcategory_id ?? "",
        comment: tx.needsReview ? "Needs review" : "",
        isDuplicate: tx.isDuplicate,
        transferMatch: null,
        categorizationSource: tx.categorizationSource,
        aiSuggestedSubcategoryId:
          tx.categorizationSource === "ai" ? tx.subcategory_id : null,
        tag_ids: [],
      }));
      const before = captureDraftSnapshot();
      const after = captureDraftSnapshot({
        rows: nextRows,
        duplicatesChecked: data.summary.duplicates > 0,
        parseSummary: summary,
        statementText: "",
        statementAccountId: "",
      });
      await executeDraftSnapshotAction("Parse statement", before, after, () =>
        successToast(`Parsed ${data.summary.total} transaction(s).`),
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Statement parsing failed.",
      );
    }
  }, [
    captureDraftSnapshot,
    executeDraftSnapshotAction,
    parseStatement,
    statementAccountId,
    statementText,
    successToast,
  ]);

  const handleSave = useCallback(async () => {
    // Validate
    const invalid = filledRows.filter((r) => !isRowValid(r));
    if (invalid.length > 0) {
      toast.error("Each row needs at least a date, name, amount, and account.");
      return;
    }

    const invalidDates = filledRows.filter((row) => !parseDisplayDate(row.date));
    if (invalidDates.length > 0) {
      toast.error("Dates must use MM/DD/YYYY.");
      return;
    }
    if (filledRows.length === 0) {
      toast.error("No transactions to save.");
      return;
    }

    const flaggedMatches = findTransactionMatches(filledRows);
    if (flaggedMatches.length > 0) {
      setFlaggedWarningMatches(flaggedMatches);
    }

    setSaving(true);

    try {
      // Check duplicates if not already checked
      if (!duplicatesChecked) {
        const dupPayload = filledRows.map((r) => ({
          date: toApiDate(r.date),
          name: r.name,
          amount: displayAmountToNumber(normalizeRowAmountDisplay(r, accounts)),
          account_id: r.account_id,
        }));

        const dupResult = await checkDuplicates.mutateAsync(dupPayload);
        const dupData = dupResult.data ?? [];
        const hasDuplicates = dupData.some(Boolean);

        if (hasDuplicates) {
          const filledIds = filledRows.map((r) => r.id);
          let filledIdx = 0;
          const nextRows = rows.map((row) => {
            if (!filledIds.includes(row.id)) return row;
            const isDuplicate = dupData[filledIdx] ?? false;
            filledIdx++;
            return { ...row, isDuplicate };
          });
          const before = captureDraftSnapshot();
          const after = captureDraftSnapshot({
            rows: nextRows,
            duplicatesChecked: true,
          });
          await executeDraftSnapshotAction(
            "Mark duplicate transactions",
            before,
            after,
            () =>
              toast.warning(
                "Some transactions may be duplicates. Remove them or click Save All again to confirm.",
              ),
          );
          return;
        }
      }

      // Build payload
      const payload: CreateTransactionData[] = filledRows.map((r) => ({
        account_id: r.account_id,
        date: toApiDate(r.date),
        name: r.name,
        amount: displayAmountToNumber(normalizeRowAmountDisplay(r, accounts)),
        kind: r.kind,
        subcategory_id: kindHasSubcategory(r.kind)
          ? r.subcategory_id || null
          : null,
        comment: r.comment || null,
        ai_suggested: r.categorizationSource === "ai",
        tag_ids: r.tag_ids,
      }));

      let createdIds: string[] = [];
      await execute({
        id: crypto.randomUUID(),
        label: "Save transactions",
        apply: async () => {
          try {
            const result = await bulkCreateTransactions.mutateAsync(payload);
            createdIds = (result.data ?? []).map(
              (transaction) => transaction.id,
            );
            successToast(`${payload.length} transaction(s) saved.`);
            setRows(initialRows());
            setDuplicatesChecked(false);
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : "Failed to save transactions.",
            );
            throw err;
          }
        },
        undo: async () => {
          if (createdIds.length > 0) {
            await bulkDeleteTransactions.mutateAsync(createdIds);
          }
        },
        redo: async () => {
          if (createdIds.length > 0) {
            await bulkRestoreTransactions.mutateAsync(createdIds);
          }
        },
      });
    } finally {
      setSaving(false);
    }
  }, [
    accounts,
    bulkCreateTransactions,
    bulkDeleteTransactions,
    bulkRestoreTransactions,
    captureDraftSnapshot,
    checkDuplicates,
    duplicatesChecked,
    execute,
    executeDraftSnapshotAction,
    filledRows,
    findTransactionMatches,
    rows,
    successToast,
  ]);

  const handleGridContainerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (handleGridKeyDown(event)) return;

      if (!saving) {
        handleEnterSave(event, () => {
          void handleSave();
        });
      }
    },
    [handleGridKeyDown, handleSave, saving],
  );

  const handleGridContainerKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key.toLowerCase() === "a" &&
        (event.ctrlKey || event.metaKey)
      ) {
        handleGridKeyDown(event);
      }
    },
    [handleGridKeyDown],
  );

  useShortcut("transactionInput.addRow", addRow);
  useShortcut(
    "transactionInput.aiCategorize",
    () => {
      void handleAICategorize();
    },
    { enabled: !categorize.isPending },
  );
  useShortcut("transactionInput.clearAll", clearAll);
  useShortcut(
    "transactionInput.saveAll",
    () => {
      void handleSave();
    },
    { enabled: !saving },
  );
  useShortcut(
    "transactionInput.parseStatement",
    () => {
      void handleParseStatement();
    },
    { enabled: !parseStatement.isPending },
  );
  useShortcut(
    "transactionInput.focusStatementText",
    useCallback(() => statementTextRef.current?.focus(), []),
  );
  useShortcut(
    "transactionInput.focusStatementAccount",
    useCallback(() => statementAccountRef.current?.focus(), []),
  );
  useShortcut(
    "transactionInput.focusGrid",
    useCallback(() => focusCell(0), [focusCell]),
  );
  useShortcut(
    "transactionInput.removeFocusedRow",
    useCallback(() => {
      if (focusedRowId) removeRow(focusedRowId);
    }, [focusedRowId, removeRow]),
    { enabled: focusedRowId !== null },
  );
  useShortcut(
    "transactionInput.nextCell",
    useCallback(() => focusAdjacentCell(1), [focusAdjacentCell]),
  );
  useShortcut(
    "transactionInput.previousCell",
    useCallback(() => focusAdjacentCell(-1), [focusAdjacentCell]),
  );

  // ── Render ────────────────────────────────────────────────────────

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: a.name })),
    [accounts],
  );

  const createTagForPicker = useCallback(
    async (
      data: CreateTagData,
      options?: TagPickerCreateOptions,
    ): Promise<Tag> => {
      let createdTag: Tag | null = null;
      let applyError: unknown = null;
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Create tag",
        apply: async () => {
          try {
            const result = await createTag.mutateAsync(data);
            if (!result.data) throw new Error("Tag creation returned no tag.");
            createdTag = result.data;
            successToast("Tag created");
          } catch (err) {
            applyError = err;
            toast.error(
              err instanceof Error ? err.message : "Failed to create tag.",
            );
            throw err;
          }
        },
        undo: async () => {
          if (createdTag) {
            await deleteTag.mutateAsync(createdTag.id);
            options?.onUndo?.(createdTag);
          }
        },
        redo: async () => {
          if (createdTag) {
            await restoreTag.mutateAsync(createdTag.id);
            options?.onRedo?.(createdTag);
          }
        },
      });
      if (applied && createdTag) return createdTag;
      throw applyError instanceof Error
        ? applyError
        : new Error("Failed to create tag.");
    },
    [createTag, deleteTag, execute, restoreTag, successToast],
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={addRow}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add Row
          <ShortcutHint commandId="transactionInput.addRow" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleAICategorize}
          loading={categorize.isPending}
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          AI Categorize
          <ShortcutHint commandId="transactionInput.aiCategorize" />
        </Button>
        <Button size="sm" variant="ghost" onClick={clearAll}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Clear All
          <ShortcutHint commandId="transactionInput.clearAll" />
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {filledRows.length} row(s) to save
        </span>
        <Button size="sm" onClick={handleSave} loading={saving}>
          <Save className="mr-1 h-3.5 w-3.5" />
          Save All
          <ShortcutHint commandId="transactionInput.saveAll" />
        </Button>
      </div>

      <Card className="p-3">
        <CardHeader className="mb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" />
            Statement Import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              ref={statementAccountRef}
              value={statementAccountId}
              onChange={(e) => setStatementAccountId(e.target.value)}
              className="h-8 rounded border border-border bg-input px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select account</option>
              {accountOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleParseStatement}
              loading={parseStatement.isPending}
            >
              Parse Statement
              <ShortcutHint commandId="transactionInput.parseStatement" />
            </Button>
            {lastRunId && (
              <span className="self-center text-xs text-muted-foreground">
                log: logs/jsonl/*-{lastRunId}.jsonl
              </span>
            )}
          </div>
          <textarea
            ref={statementTextRef}
            value={statementText}
            onChange={(e) => setStatementText(e.target.value)}
            placeholder="Paste statement lines here"
            className="min-h-20 w-full rounded border border-border bg-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {parseSummary && (
            <p className="text-xs text-muted-foreground">{parseSummary}</p>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <div
        ref={gridContainerRef}
        className="overflow-x-auto rounded-md border border-border"
        tabIndex={0}
        onCopy={handleGridCopy}
        onCut={handleGridCut}
        onPaste={handleGridPaste}
        onKeyDownCapture={handleGridContainerKeyDownCapture}
        onKeyDown={handleGridContainerKeyDown}
        onFocus={() => setGridFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setGridFocused(false);
            setFocusedRowId(null);
            setEditingCell(null);
            clearCopiedRanges();
          }
        }}
      >
        <table
          className="w-full text-xs"
          style={{ minWidth: totalWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={getColStyle(column.id)} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-card text-left text-muted-foreground">
              <th
                className="relative px-1 py-1.5"
                style={getHeaderStyle("indicator")}
              >
                <span
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                  {...getResizeHandleProps("indicator")}
                />
              </th>
              {[
                ["date", "Date"],
                ["name", "Name"],
                ["amount", "Amount"],
                ["kind", "Type"],
                ["account", "Account"],
                ["subcategory", "Subcategory"],
                ["tags", "Tags"],
                ["comment", "Comment"],
              ].map(([columnId, label]) => (
                <th
                  key={columnId}
                  className="relative px-1 py-1.5"
                  style={getHeaderStyle(columnId)}
                >
                  {label}
                  <span
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                    {...getResizeHandleProps(columnId)}
                  />
                </th>
              ))}
              <th
                className="relative px-1 py-1.5"
                style={getHeaderStyle("remove")}
              >
                <span
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                  {...getResizeHandleProps("remove")}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border last:border-b-0",
                  row.isDuplicate && "bg-yellow-500/10",
                )}
              >
                {/* Duplicate indicator */}
                <td className="px-1 py-0.5 text-center">
                  {row.isDuplicate && (
                    <AlertTriangle className="inline h-3.5 w-3.5 text-yellow-500" />
                  )}
                </td>

                {/* Date */}
                <td
                  data-row-index={idx}
                  data-col-index={0}
                  className={getCellClassName(idx, 0)}
                  {...getCellSelectionHandlers(idx, 0)}
                >
                  <input
                    ref={(node) => {
                      cellRefs.current[idx * 8] = node;
                    }}
                    type="text"
                    placeholder="MM/DD/YYYY"
                    value={row.date}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRow(row.id, "date", formatDateInput(e.target.value))
                    }
                    onPaste={(e) => handlePaste(e, idx, "date")}
                    onFocus={() => handleCellFocus(row.id, idx, 0)}
                    className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                {/* Name */}
                <td
                  data-row-index={idx}
                  data-col-index={1}
                  className={getCellClassName(idx, 1)}
                  {...getCellSelectionHandlers(idx, 1)}
                >
                  <input
                    ref={(node) => {
                      cellRefs.current[idx * 8 + 1] = node;
                    }}
                    type="text"
                    placeholder="Description"
                    value={row.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRow(row.id, "name", e.target.value)
                    }
                    onPaste={(e) => handlePaste(e, idx, "name")}
                    onFocus={() => handleCellFocus(row.id, idx, 1)}
                    className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                {/* Amount */}
                <td
                  data-row-index={idx}
                  data-col-index={2}
                  className={getCellClassName(idx, 2)}
                  {...getCellSelectionHandlers(idx, 2)}
                >
                  <input
                    ref={(node) => {
                      cellRefs.current[idx * 8 + 2] = node;
                    }}
                    type="text"
                    placeholder="0.00"
                    value={row.amount}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setRows((prev) =>
                        prev.map((r) =>
                          r.id === row.id
                            ? {
                                ...r,
                                amount: e.target.value,
                                isDuplicate: false,
                              }
                            : r,
                        ),
                      )
                    }
                    onBlur={() =>
                      updateRow(
                        row.id,
                        "amount",
                        normalizeRowAmountDisplay(row, accounts),
                      )
                    }
                    onPaste={(e) => handlePaste(e, idx, "amount")}
                    onFocus={() => handleCellFocus(row.id, idx, 2)}
                    className="h-7 w-full rounded border border-border bg-input px-1.5 text-right text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                {/* Type */}
                <td
                  data-row-index={idx}
                  data-col-index={3}
                  className={getCellClassName(idx, 3)}
                  {...getCellSelectionHandlers(idx, 3)}
                >
                  <select
                    ref={(node) => {
                      cellRefs.current[idx * 8 + 3] = node;
                    }}
                    value={row.kind}
                    onChange={(e) =>
                      handleKindChange(row, e.target.value as TransactionKind)
                    }
                    onPaste={(e) => handlePaste(e, idx, "kind")}
                    onFocus={() => handleCellFocus(row.id, idx, 3)}
                    className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                    <option value="transfer">Transfer</option>
                    <option value="adjustment">Adjustment</option>
                  </select>
                </td>

                {/* Account */}
                <td
                  data-row-index={idx}
                  data-col-index={4}
                  className={getCellClassName(idx, 4)}
                  {...getCellSelectionHandlers(idx, 4)}
                >
                  <select
                    ref={(node) => {
                      cellRefs.current[idx * 8 + 4] = node;
                    }}
                    value={row.account_id}
                    onChange={(e) => {
                      const accountId = e.target.value;
                      setRows((prev) =>
                        prev.map((r) =>
                          r.id === row.id
                            ? {
                                ...r,
                                account_id: accountId,
                                amount: formatAmountDisplay(
                                  r.amount,
                                  getAccountType(accountId, accounts),
                                  r.kind,
                                ),
                                isDuplicate: false,
                              }
                            : r,
                        ),
                      );
                      setDuplicatesChecked(false);
                    }}
                    onPaste={(e) => handlePaste(e, idx, "account_id")}
                    onFocus={() => handleCellFocus(row.id, idx, 4)}
                    className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">--</option>
                    {accountOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>

                {/* Subcategory (grouped) */}
                <td
                  data-row-index={idx}
                  data-col-index={5}
                  className={getCellClassName(idx, 5)}
                  {...getCellSelectionHandlers(idx, 5)}
                >
                  <GroupedSubcategorySelect
                    refIndex={idx * 8 + 5}
                    registerRef={(index, node) => {
                      cellRefs.current[index] = node;
                    }}
                    value={row.subcategory_id}
                    onChange={(val) => handleSubcategoryChange(row, val)}
                    categories={categories}
                    subcategories={subcategories}
                    className={cn(
                      !kindHasSubcategory(row.kind) && "opacity-60",
                    )}
                    disabled={!kindHasSubcategory(row.kind)}
                    onPaste={(e) => handlePaste(e, idx, "subcategory_id")}
                    onFocus={() => handleCellFocus(row.id, idx, 5)}
                  />
                  {row.categorizationSource !== "manual" && (
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {row.categorizationSource}
                    </div>
                  )}
                </td>

                {/* Tags */}
                <td
                  data-row-index={idx}
                  data-col-index={6}
                  className={getCellClassName(idx, 6)}
                  {...getCellSelectionHandlers(idx, 6)}
                >
                  <div
                    onPaste={(e) => handlePaste(e, idx, "tag_ids")}
                    onFocus={() => handleCellFocus(row.id, idx, 6)}
                  >
                    <TagPicker
                      ref={(node) => {
                        cellRefs.current[idx * 8 + 6] = node;
                      }}
                      value={row.tag_ids}
                      onChange={(tagIds) =>
                        updateRow(row.id, "tag_ids", tagIds)
                      }
                      tags={tags}
                      onCreateTag={createTagForPicker}
                      placeholder="Tags"
                      className="w-full"
                    />
                  </div>
                </td>

                {/* Comment */}
                <td
                  data-row-index={idx}
                  data-col-index={7}
                  className={getCellClassName(idx, 7)}
                  {...getCellSelectionHandlers(idx, 7)}
                >
                  <input
                    ref={(node) => {
                      cellRefs.current[idx * 8 + 7] = node;
                    }}
                    type="text"
                    placeholder="Note"
                    value={row.comment}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRow(row.id, "comment", e.target.value)
                    }
                    onPaste={(e) => handlePaste(e, idx, "comment")}
                    onFocus={() => handleCellFocus(row.id, idx, 7)}
                    className="h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                {/* Remove */}
                <td className="px-1 py-0.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    onFocus={() => setFocusedRowId(row.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label="Remove row"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: Paste tab-delimited data to populate rows, paste one value over a
        selected range to fill it, use Delete/Backspace to clear selected cells,
        and use Arrow keys to move between cells.
      </p>

      <Modal
        open={flaggedWarningMatches.length > 0}
        onOpenChange={(open) => {
          if (!open) setFlaggedWarningMatches([]);
        }}
        title="Flagged transaction warning"
        description="These transaction names contain flagged words. Saving continues automatically."
        size="md"
      >
        <div className="space-y-3">
          <div className="flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <span>
              Review these transactions for interest, fees, or other configured
              flagged words.
            </span>
          </div>
          <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
            {flaggedWarningMatches.map((match, index) => (
              <li
                key={`${match.name}-${index}`}
                className="rounded-md border border-border bg-secondary/20 px-3 py-2"
              >
                <div className="font-medium text-foreground">{match.name}</div>
                <div className="text-xs text-muted-foreground">
                  Matched: {match.words.join(", ")}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => setFlaggedWarningMatches([])}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
