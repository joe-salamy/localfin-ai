import { useState, useMemo, useCallback, useRef } from 'react';
import type { TransactionFilters, TransactionKind } from '@/types';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import { useTransactions } from '@/hooks/useTransactions';
import { useAccounts } from '@/hooks/useAccounts';
import { useCategories } from '@/hooks/useCategories';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/MultiSelect';
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
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [subcategoryIds, setSubcategoryIds] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<'all' | TransactionKind | 'needsCategory'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLButtonElement>(null);
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
  const { categories, subcategories } = useCategories();

  const applyFilters = useCallback(() => {
    setSelectedIds(new Set());
    setAppliedFilters({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      accountIds: accountIds.length > 0 ? accountIds : undefined,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      subcategoryIds: subcategoryIds.length > 0 ? subcategoryIds : undefined,
      kind: kindFilter !== 'all' && kindFilter !== 'needsCategory' ? kindFilter : undefined,
      needsCategory: kindFilter === 'needsCategory' ? true : undefined,
      searchQuery: searchQuery || undefined,
    });
  }, [accountIds, categoryIds, endDate, kindFilter, searchQuery, startDate, subcategoryIds]);

  const applyDateRangePreset = useCallback((preset: DateRangePreset) => {
    const range = preset.getRange();
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setSelectedIds(new Set());
    setAppliedFilters({
      startDate: range.startDate || undefined,
      endDate: range.endDate || undefined,
      accountIds: accountIds.length > 0 ? accountIds : undefined,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      subcategoryIds: subcategoryIds.length > 0 ? subcategoryIds : undefined,
      kind: kindFilter !== 'all' && kindFilter !== 'needsCategory' ? kindFilter : undefined,
      needsCategory: kindFilter === 'needsCategory' ? true : undefined,
      searchQuery: searchQuery || undefined,
    });
  }, [accountIds, categoryIds, kindFilter, searchQuery, subcategoryIds]);

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

  const handleBulkEdit = useCallback(async (updates: { kind?: TransactionKind; subcategory_id?: string | null }) => {
    try {
      await bulkUpdateTransactions.mutateAsync({
        ids: Array.from(selectedIds),
        updates,
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

  const handleCategoryIdsChange = useCallback((nextCategoryIds: string[]) => {
    setCategoryIds(nextCategoryIds);

    if (nextCategoryIds.length === 0) return;
    const selectedCategories = new Set(nextCategoryIds);
    const compatibleSubcategoryIds = new Set(
      subcategories
        .filter((subcategory) => selectedCategories.has(subcategory.category_id))
        .map((subcategory) => subcategory.id),
    );
    setSubcategoryIds((current) => current.filter((id) => compatibleSubcategoryIds.has(id)));
  }, [subcategories]);

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const categoryOptions = categories.map((category) => ({ value: category.id, label: category.name }));
  const selectedCategorySet = useMemo(() => new Set(categoryIds), [categoryIds]);
  const subcategoryOptions = subcategories
    .filter((subcategory) => categoryIds.length === 0 || selectedCategorySet.has(subcategory.category_id))
    .map((subcategory) => {
      const category = categories.find((item) => item.id === subcategory.category_id);
      return {
        value: subcategory.id,
        label: category ? `${category.name} / ${subcategory.name}` : subcategory.name,
      };
    });
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
          <MultiSelect
            ref={accountRef}
            value={accountIds}
            onChange={setAccountIds}
            options={accountOptions}
            allLabel="All Accounts"
            selectedLabel="accounts"
          />
        </div>
        <div className="w-40">
          <MultiSelect
            value={categoryIds}
            onChange={handleCategoryIdsChange}
            options={categoryOptions}
            allLabel="All Categories"
            selectedLabel="categories"
          />
        </div>
        <div className="w-48">
          <MultiSelect
            value={subcategoryIds}
            onChange={setSubcategoryIds}
            options={subcategoryOptions}
            allLabel="All Subcategories"
            selectedLabel="subcategories"
          />
        </div>
        <div className="w-40">
          <SimpleSelect
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
            options={[
              { value: 'all', label: 'All Types' },
              { value: 'income', label: 'Income' },
              { value: 'expense', label: 'Expense' },
              { value: 'transfer', label: 'Transfer' },
              { value: 'needsCategory', label: 'Needs Category' },
            ]}
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
          categories={categories}
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
        categories={categories}
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
