import { useState, useMemo, useCallback, useRef } from 'react';
import type { TransactionFilters } from '@/types';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import { useTransactions } from '@/hooks/useTransactions';
import { useAccounts } from '@/hooks/useAccounts';
import { useCategories } from '@/hooks/useCategories';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SimpleSelect } from '@/components/ui/SimpleSelect';
import { TransactionTable } from '@/components/features/TransactionTable';
import { BulkEditModal } from '@/components/features/BulkEditModal';
import { ConfirmDeleteModal } from '@/components/features/ConfirmDeleteModal';
import { DEFAULT_DATE_RANGE_DAYS, DATE_FORMAT } from '@/config/constants';
import { dateRangePresets, type DateRangePreset } from '@/lib/dateRangePresets';
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint';
import { useShortcut, useShortcutScope } from '@/features/shortcuts/hooks';
import type { CommandId } from '@/features/shortcuts/commands';

const today = format(new Date(), DATE_FORMAT);
const defaultStart = format(subDays(new Date(), DEFAULT_DATE_RANGE_DAYS), DATE_FORMAT);

export function TransactionHistoryPage() {
  // Filter state
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);
  const [accountId, setAccountId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useShortcutScope('transactionHistory');

  // Applied filters (only update on Apply click)
  const [appliedFilters, setAppliedFilters] = useState<TransactionFilters>({
    startDate: defaultStart,
    endDate: today,
  });

  // Sort state
  const [sortColumn, setSortColumn] = useState('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bulk modals
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Data hooks
  const { transactions, isLoading, error, updateTransaction, deleteTransaction, bulkUpdateTransactions, bulkDeleteTransactions } = useTransactions(appliedFilters);
  const { accounts } = useAccounts();
  const { subcategories } = useCategories();

  const applyFilters = useCallback(() => {
    setSelectedIds(new Set());
    setAppliedFilters({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      accountId: accountId || undefined,
      searchQuery: searchQuery || undefined,
    });
  }, [accountId, endDate, searchQuery, startDate]);

  const applyDateRangePreset = useCallback((preset: DateRangePreset) => {
    const range = preset.getRange();
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setSelectedIds(new Set());
    setAppliedFilters({
      startDate: range.startDate || undefined,
      endDate: range.endDate || undefined,
      accountId: accountId || undefined,
      searchQuery: searchQuery || undefined,
    });
  }, [accountId, searchQuery]);

  // Sort transactions client-side
  const sortedTransactions = useMemo(() => {
    const sorted = [...transactions];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'date':
          cmp = a.date.localeCompare(b.date);
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'amount':
          cmp = a.amount - b.amount;
          break;
        case 'balance':
          cmp = (a.running_balance ?? 0) - (b.running_balance ?? 0);
          break;
        default:
          cmp = 0;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [transactions, sortColumn, sortDirection]);

  const handleSort = useCallback((column: string) => {
    setSortDirection((prev) => (sortColumn === column ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortColumn(column);
  }, [sortColumn]);

  const handleEdit = useCallback(async (id: string, updates: Record<string, unknown>) => {
    try {
      await updateTransaction.mutateAsync({ id, ...updates } as Parameters<typeof updateTransaction.mutateAsync>[0]);
      toast.success('Transaction updated');
    } catch {
      toast.error('Failed to update transaction');
    }
  }, [updateTransaction]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteTransaction.mutateAsync(id);
      selectedIds.delete(id);
      setSelectedIds(new Set(selectedIds));
      toast.success('Transaction deleted');
    } catch {
      toast.error('Failed to delete transaction');
    }
  }, [deleteTransaction, selectedIds]);

  const handleBulkEdit = useCallback(async (subcategoryId: string) => {
    try {
      await bulkUpdateTransactions.mutateAsync({
        ids: Array.from(selectedIds),
        updates: { subcategory_id: subcategoryId },
      });
      toast.success(`Updated ${selectedIds.size} transactions`);
      setSelectedIds(new Set());
      setBulkEditOpen(false);
    } catch {
      toast.error('Failed to bulk update');
    }
  }, [bulkUpdateTransactions, selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    try {
      await bulkDeleteTransactions.mutateAsync(Array.from(selectedIds));
      toast.success(`Deleted ${selectedIds.size} transactions`);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
    } catch {
      toast.error('Failed to bulk delete');
    }
  }, [bulkDeleteTransactions, selectedIds]);

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const searchError = error instanceof Error && appliedFilters.searchQuery
    ? error.message
    : null;

  const applyPreset1 = useCallback(() => dateRangePresets[0] && applyDateRangePreset(dateRangePresets[0]), [applyDateRangePreset]);
  const applyPreset2 = useCallback(() => dateRangePresets[1] && applyDateRangePreset(dateRangePresets[1]), [applyDateRangePreset]);
  const applyPreset3 = useCallback(() => dateRangePresets[2] && applyDateRangePreset(dateRangePresets[2]), [applyDateRangePreset]);
  const applyPreset4 = useCallback(() => dateRangePresets[3] && applyDateRangePreset(dateRangePresets[3]), [applyDateRangePreset]);
  const applyPreset5 = useCallback(() => dateRangePresets[4] && applyDateRangePreset(dateRangePresets[4]), [applyDateRangePreset]);
  const applyPreset6 = useCallback(() => dateRangePresets[5] && applyDateRangePreset(dateRangePresets[5]), [applyDateRangePreset]);
  useShortcut('transactionHistory.applyFilters', applyFilters);
  useShortcut('transactionHistory.focusSearch', useCallback(() => searchRef.current?.focus(), []));
  useShortcut('transactionHistory.focusStartDate', useCallback(() => startDateRef.current?.focus(), []));
  useShortcut('transactionHistory.focusEndDate', useCallback(() => endDateRef.current?.focus(), []));
  useShortcut('transactionHistory.focusAccount', useCallback(() => accountRef.current?.focus(), []));
  useShortcut('transactionHistory.preset1', applyPreset1, { enabled: dateRangePresets.length > 0 });
  useShortcut('transactionHistory.preset2', applyPreset2, { enabled: dateRangePresets.length > 1 });
  useShortcut('transactionHistory.preset3', applyPreset3, { enabled: dateRangePresets.length > 2 });
  useShortcut('transactionHistory.preset4', applyPreset4, { enabled: dateRangePresets.length > 3 });
  useShortcut('transactionHistory.preset5', applyPreset5, { enabled: dateRangePresets.length > 4 });
  useShortcut('transactionHistory.preset6', applyPreset6, { enabled: dateRangePresets.length > 5 });
  useShortcut('transactionHistory.bulkEdit', useCallback(() => setBulkEditOpen(true), []), { enabled: selectedIds.size > 0 });
  useShortcut('transactionHistory.bulkDelete', useCallback(() => setBulkDeleteOpen(true), []), { enabled: selectedIds.size > 0 });

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Transaction History</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">From</label>
          <input
            ref={startDateRef}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-8 rounded border border-border bg-input px-2 text-xs text-foreground"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">To</label>
          <input
            ref={endDateRef}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-8 rounded border border-border bg-input px-2 text-xs text-foreground"
          />
        </div>
        <div className="w-40">
          <SimpleSelect
            ref={accountRef}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            options={[{ value: '', label: 'All Accounts' }, ...accountOptions]}
            className="h-8 text-xs"
          />
        </div>
        <div className="w-48">
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search: coffee AND amount>5"
            className="h-8 text-xs"
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </div>
        <Button size="sm" onClick={applyFilters} className="h-8 text-xs">
          Apply
          <ShortcutHint commandId="transactionHistory.applyFilters" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {dateRangePresets.map((preset, index) => {
          const range = preset.getRange();
          const isActive =
            (appliedFilters.startDate ?? '') === range.startDate &&
            (appliedFilters.endDate ?? '') === range.endDate;
          const commandId = `transactionHistory.preset${index + 1}` as CommandId;

          return (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant={isActive ? 'primary' : 'secondary'}
              onClick={() => applyDateRangePreset(preset)}
              className="h-7 px-2 text-xs"
            >
              {preset.label}
              {index < 6 && <ShortcutHint commandId={commandId} />}
            </Button>
          );
        })}
      </div>
      {searchError && (
        <div className="text-xs text-destructive">{searchError}</div>
      )}

      {/* Action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{selectedIds.size} selected</span>
          <Button size="sm" variant="secondary" onClick={() => setBulkEditOpen(true)} className="h-7 text-xs">
            Bulk Edit
            <ShortcutHint commandId="transactionHistory.bulkEdit" />
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)} className="h-7 text-xs">
            Bulk Delete
            <ShortcutHint commandId="transactionHistory.bulkDelete" />
          </Button>
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
      ) : (
        <TransactionTable
          transactions={sortedTransactions}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
          onEdit={handleEdit}
          onDelete={handleDelete}
          subcategories={subcategories}
        />
      )}

      <div className="text-xs text-muted-foreground">
        {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
      </div>

      {/* Bulk edit modal */}
      <BulkEditModal
        isOpen={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        onConfirm={handleBulkEdit}
        selectedCount={selectedIds.size}
        subcategories={subcategories}
        isLoading={bulkUpdateTransactions.isPending}
      />

      {/* Bulk delete confirmation */}
      <ConfirmDeleteModal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title="Bulk Delete"
        message={`Delete ${selectedIds.size} selected transaction${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
        isLoading={bulkDeleteTransactions.isPending}
      />
    </div>
  );
}
