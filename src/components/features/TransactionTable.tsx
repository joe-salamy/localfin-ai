import { useState } from 'react';
import type { ClipboardEvent } from 'react';
import type { TransactionWithDetails, Subcategory } from '@/types';
import { format, parseISO } from 'date-fns';
import { Pencil, Trash2, Check, X, ArrowUp, ArrowDown } from 'lucide-react';
import { ConfirmDeleteModal } from '@/components/features/ConfirmDeleteModal';
import { formatCurrency, cn } from '@/lib/utils';
import { DISPLAY_DATE_FORMAT } from '@/config/constants';

interface TransactionTableProps {
  transactions: TransactionWithDetails[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
  onEdit: (id: string, updates: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  subcategories: Subcategory[];
}

interface EditState {
  date: string;
  name: string;
  amount: string;
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
  subcategories,
}: TransactionTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ date: '', name: '', amount: '', subcategory_id: '', comment: '' });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TransactionWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);

  const allSelected = transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id));

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(transactions.map((t) => t.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  };

  const startEdit = (t: TransactionWithDetails) => {
    setEditingId(t.id);
    setEditState({
      date: t.date,
      name: t.name,
      amount: String(t.amount),
      subcategory_id: t.subcategory_id ?? '',
      comment: t.comment ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await onEdit(editingId, {
        date: editState.date,
        name: editState.name,
        amount: parseFloat(editState.amount),
        subcategory_id: editState.subcategory_id || null,
        comment: editState.comment || null,
      });
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

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
      <div className="overflow-x-auto border border-border rounded-md">
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
              <th className={headerClass}>Account</th>
              <th className={cn(headerClass, 'w-20')}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {transactions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-8 text-center text-sm text-muted-foreground">
                  No transactions found.
                </td>
              </tr>
            )}
            {transactions.map((t) => {
              const isEditing = editingId === t.id;
              return (
                <tr
                  key={t.id}
                  className={cn(
                    'hover:bg-secondary/30',
                    selectedIds.has(t.id) && 'bg-secondary/20',
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
                      <span className={t.amount >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {formatCurrency(t.amount)}
                      </span>
                    )}
                  </td>
                  <td className={cn(cellClass, 'text-right font-mono tabular-nums')}>
                    {formatCurrency(t.running_balance ?? 0)}
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
                        className="h-7 w-36 rounded border border-border bg-input px-1.5 text-xs text-foreground"
                      >
                        <option value="">None</option>
                        {subcategories.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs">
                        {t.category_name && t.subcategory_name
                          ? `${t.category_name} > ${t.subcategory_name}`
                          : t.subcategory_name ?? '-'}
                      </span>
                    )}
                  </td>
                  <td className={cn(cellClass, 'text-xs')}>{t.account_name ?? '-'}</td>
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
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="p-1 rounded hover:bg-secondary text-muted-foreground"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
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
