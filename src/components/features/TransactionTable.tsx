import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import type { TransactionKind, TransactionWithDetails, Subcategory } from '@/types';
import { format, parseISO } from 'date-fns';
import { Pencil, Trash2, Check, X, ArrowUp, ArrowDown } from 'lucide-react';
import { ConfirmDeleteModal } from '@/components/features/ConfirmDeleteModal';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { formatCurrency, cn } from '@/lib/utils';
import { DISPLAY_DATE_FORMAT } from '@/config/constants';
import { buildCategoryLookup, formatSubcategoryLabel, formatNullableSubcategoryLabel } from '@/lib/categoryLabels';
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint';
import { useShortcut, useShortcutScope } from '@/features/shortcuts/hooks';
import { useAmountGradient } from '@/features/display-settings/hooks';
import { useFlaggedWords } from '@/features/flagged-words/hooks';
import type { Category } from '@/types';

interface TransactionTableProps {
  transactions: TransactionWithDetails[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
  onEdit: (id: string, updates: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  categories: Category[];
  subcategories: Subcategory[];
}

interface EditState {
  date: string;
  name: string;
  amount: string;
  kind: TransactionKind;
  subcategory_id: string;
  comment: string;
}

function normalizeClipboardValue(value: string): string {
  return value.trim().toLowerCase();
}

function resolveSubcategoryId(value: string, subcategories: Subcategory[]): string | null {
  const normalized = normalizeClipboardValue(value);
  if (!normalized) return null;

  const parts = value.split('>').map((part) => part.trim()).filter(Boolean);
  const candidateName = normalizeClipboardValue(parts[parts.length - 1] ?? value);

  return subcategories.find((subcategory) => (
    subcategory.id.toLowerCase() === normalized ||
    subcategory.name.toLowerCase() === normalized ||
    subcategory.name.toLowerCase() === candidateName
  ))?.id ?? null;
}

function SortIcon({ column, sortColumn, sortDirection }: { column: string; sortColumn: string; sortDirection: 'asc' | 'desc' }) {
  if (column !== sortColumn) return null;
  return sortDirection === 'asc'
    ? <ArrowUp className="inline h-3 w-3 ml-0.5" />
    : <ArrowDown className="inline h-3 w-3 ml-0.5" />;
}

const sortableColumns = [
  { id: 'date', label: 'Date', align: 'left' },
  { id: 'name', label: 'Name', align: 'left' },
  { id: 'amount', label: 'Amount', align: 'right' },
  { id: 'balance', label: 'Balance', align: 'right' },
] as const;

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
}: TransactionTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ date: '', name: '', amount: '', kind: 'expense', subcategory_id: '', comment: '' });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TransactionWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(transactions[0]?.id ?? null);
  const [tableFocused, setTableFocused] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const getGradientStyle = useAmountGradient(transactions.map((transaction) => transaction.amount));
  const { findMatches } = useFlaggedWords();
  const categoryLookup = buildCategoryLookup(categories);

  const allSelected = transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id));
  const focusedTransaction = transactions.find((transaction) => transaction.id === focusedId) ?? transactions[0] ?? null;

  useShortcutScope('transactionHistoryTable', tableFocused || editingId !== null);
  useShortcutScope('transactionHistoryEdit', editingId !== null);

  useEffect(() => {
    if (transactions.length === 0) {
      setFocusedId(null);
      return;
    }
    if (!focusedId || !transactions.some((transaction) => transaction.id === focusedId)) {
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

  const toggleOne = useCallback((id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  }, [onSelectionChange, selectedIds]);

  const focusRow = useCallback((id: string | null) => {
    if (!id) return;
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  }, []);

  const focusRowByOffset = useCallback((offset: number) => {
    if (transactions.length === 0) return;
    const currentIndex = Math.max(0, transactions.findIndex((transaction) => transaction.id === focusedId));
    const nextIndex = Math.max(0, Math.min(currentIndex + offset, transactions.length - 1));
    focusRow(transactions[nextIndex]?.id ?? null);
  }, [focusRow, focusedId, transactions]);

  const startEdit = useCallback((t: TransactionWithDetails) => {
    setEditingId(t.id);
    setEditState({
      date: t.date,
      name: t.name,
      amount: String(t.amount),
      kind: t.kind,
      subcategory_id: t.subcategory_id ?? '',
      comment: t.comment ?? '',
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await onEdit(editingId, {
        date: editState.date,
        name: editState.name,
        amount: parseFloat(editState.amount),
        kind: editState.kind,
        subcategory_id: editState.kind === 'transfer' ? null : editState.subcategory_id || null,
        comment: editState.comment || null,
      });
      setEditingId(null);
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

  useShortcut('transactionHistory.selectAll', toggleAll);
  useShortcut('transactionHistory.toggleFocusedRow', useCallback(() => {
    if (focusedTransaction) toggleOne(focusedTransaction.id);
  }, [focusedTransaction, toggleOne]));
  useShortcut('transactionHistory.editFocusedRow', useCallback(() => {
    if (focusedTransaction && editingId === null) startEdit(focusedTransaction);
  }, [editingId, focusedTransaction, startEdit]));
  useShortcut('transactionHistory.saveEdit', useCallback(() => {
    void saveEdit();
  }, [saveEdit]));
  useShortcut('transactionHistory.cancelEdit', cancelEdit, { enabled: editingId !== null });
  useShortcut('transactionHistory.deleteFocusedRow', useCallback(() => {
    if (focusedTransaction && editingId === null) setDeleteTarget(focusedTransaction);
  }, [editingId, focusedTransaction]));
  useShortcut('transactionHistory.sortDate', useCallback(() => onSort('date'), [onSort]));
  useShortcut('transactionHistory.sortName', useCallback(() => onSort('name'), [onSort]));
  useShortcut('transactionHistory.sortAmount', useCallback(() => onSort('amount'), [onSort]));
  useShortcut('transactionHistory.sortBalance', useCallback(() => onSort('balance'), [onSort]));
  useShortcut('transactionHistory.nextRow', useCallback(() => focusRowByOffset(1), [focusRowByOffset]));
  useShortcut('transactionHistory.previousRow', useCallback(() => focusRowByOffset(-1), [focusRowByOffset]));
  useShortcut('transactionHistory.firstRow', useCallback(() => focusRow(transactions[0]?.id ?? null), [focusRow, transactions]));
  useShortcut('transactionHistory.lastRow', useCallback(() => focusRow(transactions[transactions.length - 1]?.id ?? null), [focusRow, transactions]));

  const applySubcategoryPaste = async (
    e: ClipboardEvent<HTMLElement>,
    transaction: TransactionWithDetails,
  ) => {
    if (e.defaultPrevented) return;

    const text = e.clipboardData.getData('text/plain');
    const values = text
      .split(/\r?\n/)
      .map((line) => line.split('\t')[0]?.trim() ?? '')
      .filter(Boolean);
    if (values.length === 0) return;

    const resolvedIds = values.map((value) => resolveSubcategoryId(value, subcategories));
    if (resolvedIds.every((id) => !id)) return;

    e.preventDefault();

    if (editingId === transaction.id) {
      const firstResolvedId = resolvedIds.find((id): id is string => id != null);
      if (firstResolvedId) {
        setEditState((current) => ({ ...current, subcategory_id: firstResolvedId }));
      }
      return;
    }

    const targetTransactions =
      selectedIds.size > 0
        ? transactions.filter((item) => selectedIds.has(item.id))
        : transactions.slice(transactions.findIndex((item) => item.id === transaction.id));
    const updates = values.length === 1
      ? targetTransactions.map((item) => ({ item, subcategoryId: resolvedIds[0] }))
      : targetTransactions
        .slice(0, resolvedIds.length)
        .map((item, index) => ({ item, subcategoryId: resolvedIds[index] }));

    for (const update of updates) {
      if (!update.subcategoryId) continue;
      await onEdit(update.item.id, { subcategory_id: update.subcategoryId });
    }
  };

  const headerClass = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider';
  const cellClass = 'px-2 py-1.5 text-sm whitespace-nowrap';

  return (
    <>
      <div
        className="overflow-x-auto border border-border rounded-md"
        onFocus={() => setTableFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setTableFocused(false);
          }
        }}
      >
        <table className="w-full">
          <thead className="bg-secondary/50">
            <tr>
              <th className={cn(headerClass, 'w-8')}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-border"
                />
              </th>
              {sortableColumns.map((col) => (
                <th
                  key={col.id}
                  className={cn(
                    headerClass,
                    col.align === 'right' && 'text-right',
                    'cursor-pointer select-none hover:text-foreground',
                  )}
                  onClick={() => onSort(col.id)}
                >
                  {col.label}
                  <SortIcon column={col.id} sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
              ))}
              <th className={headerClass}>Category</th>
              <th className={headerClass}>Type</th>
              <th className={headerClass}>Subcategory</th>
              <th className={headerClass}>Account</th>
              <th className={cn(headerClass, 'w-20')}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {transactions.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2 py-8 text-center text-sm text-muted-foreground">
                  No transactions found.
                </td>
              </tr>
            )}
            {transactions.map((t) => {
              const isEditing = editingId === t.id;
              const flaggedWords = findMatches(t.name);
              const isFlagged = flaggedWords.length > 0;
              const amountGradientStyle = t.kind === 'transfer' ? undefined : getGradientStyle(t.amount);
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
                  title={isFlagged ? `Flagged words: ${flaggedWords.join(', ')}` : undefined}
                  className={cn(
                    'outline-none hover:bg-secondary/30 focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring',
                    selectedIds.has(t.id) && 'bg-secondary/20',
                    focusedId === t.id && 'bg-secondary/30',
                    isFlagged && 'bg-red-500/25 hover:bg-red-500/30 focus-visible:bg-red-500/30',
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
                  <td className={cellClass}>
                    {isEditing ? (
                      <input
                        type="date"
                        value={editState.date}
                        onChange={(e) => setEditState({ ...editState, date: e.target.value })}
                        className="h-7 w-32 rounded border border-border bg-input px-1.5 text-xs text-foreground"
                      />
                    ) : (
                      format(parseISO(t.date), DISPLAY_DATE_FORMAT)
                    )}
                  </td>
                  <td className={cellClass}>
                    {isEditing ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={editState.name}
                          onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                          className="h-7 w-40 rounded border border-border bg-input px-1.5 text-xs text-foreground"
                        />
                        <input
                          type="text"
                          value={editState.comment}
                          onChange={(e) => setEditState({ ...editState, comment: e.target.value })}
                          placeholder="Comment..."
                          className="h-7 w-40 rounded border border-border bg-input px-1.5 text-xs text-muted-foreground"
                        />
                      </div>
                    ) : (
                      <div>
                        <span>{t.name}</span>
                        {t.comment && (
                          <span className="block text-xs text-muted-foreground truncate max-w-[200px]">{t.comment}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className={cn(cellClass, 'text-right font-mono tabular-nums')}>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editState.amount}
                        onChange={(e) => setEditState({ ...editState, amount: e.target.value })}
                        className="h-7 w-24 rounded border border-border bg-input px-1.5 text-xs text-foreground"
                      />
                    ) : (
                      <span
                        className={t.kind === 'transfer' ? 'text-muted-foreground' : t.amount >= 0 ? 'text-green-400' : 'text-red-400'}
                        style={amountGradientStyle}
                      >
                        {formatCurrency(t.amount)}
                      </span>
                    )}
                  </td>
                  <td className={cn(cellClass, 'text-right font-mono tabular-nums')}>
                    {formatCurrency(t.running_balance ?? 0)}
                  </td>
                  <td className={cn(cellClass, 'text-xs')}>
                    <EntityLabel id={t.category_id} name={t.category_name} color={t.category_color} />
                  </td>
                  <td className={cn(cellClass, 'text-xs')}>
                    {isEditing ? (
                      <select
                        value={editState.kind}
                        onChange={(e) =>
                          setEditState({
                            ...editState,
                            kind: e.target.value as TransactionKind,
                            subcategory_id:
                              e.target.value === 'transfer'
                                ? ''
                                : editState.subcategory_id,
                          })
                        }
                        className="h-7 w-24 rounded border border-border bg-input px-1.5 text-xs text-foreground"
                      >
                        <option value="income">Income</option>
                        <option value="expense">Expense</option>
                        <option value="transfer">Transfer</option>
                      </select>
                    ) : (
                      <span className="capitalize text-muted-foreground">{t.kind}</span>
                    )}
                  </td>
                  <td
                    className={cellClass}
                    tabIndex={isEditing ? undefined : 0}
                    onPaste={(e) => void applySubcategoryPaste(e, t)}
                    title="Paste a copied subcategory here to apply it to this row or selected rows"
                  >
                    {isEditing ? (
                      <select
                        value={editState.subcategory_id}
                        onChange={(e) => setEditState({ ...editState, subcategory_id: e.target.value })}
                        onPaste={(e) => void applySubcategoryPaste(e, t)}
                        disabled={editState.kind === 'transfer'}
                        className="h-7 w-36 rounded border border-border bg-input px-1.5 text-xs text-foreground"
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
                          name={formatNullableSubcategoryLabel(t.subcategory_name, t.category_type)}
                          color={t.subcategory_color}
                        />
                      </span>
                    )}
                  </td>
                  <td className={cn(cellClass, 'text-xs')}>
                    <EntityLabel id={t.account_id} name={t.account_name} color={t.account_color} />
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
        message={deleteTarget ? `Delete "${deleteTarget.name}" (${formatCurrency(deleteTarget.amount)})?` : ''}
        isLoading={deleting}
      />
    </>
  );
}
