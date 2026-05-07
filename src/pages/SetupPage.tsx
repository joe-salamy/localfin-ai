import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Plus,
  Lock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SimpleSelect } from '@/components/ui/SimpleSelect';
import { ConfirmDeleteModal } from '@/components/features/ConfirmDeleteModal';
import { useAccounts } from '@/hooks/useAccounts';
import { useCategories } from '@/hooks/useCategories';
import type { AccountWithBalance, Category, Subcategory } from '@/types';
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint';
import { useShortcut, useShortcutScope } from '@/features/shortcuts/hooks';

// ─── Helpers ──────────────────────────────────────────────

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    asset: 'bg-emerald-900/50 text-emerald-400',
    liability: 'bg-red-900/50 text-red-400',
    income: 'bg-blue-900/50 text-blue-400',
    expense: 'bg-orange-900/50 text-orange-400',
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${colors[type] ?? 'bg-secondary text-foreground'}`}>
      {type}
    </span>
  );
}

type SortDirection = 'asc' | 'desc';

interface SortConfig<TKey extends string> {
  key: TKey;
  direction: SortDirection;
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function applySortDirection(value: number, direction: SortDirection) {
  return direction === 'asc' ? value : -value;
}

function nextSort<TKey extends string>(
  current: SortConfig<TKey>,
  key: TKey
): SortConfig<TKey> {
  if (current.key !== key) return { key, direction: 'asc' };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

function SortHeader<TKey extends string>({
  label,
  sortKey,
  sort,
  align = 'left',
  onSort,
}: {
  label: string;
  sortKey: TKey;
  sort: SortConfig<TKey>;
  align?: 'left' | 'right';
  onSort: (key: TKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 font-medium hover:text-foreground ${
        align === 'right' ? 'justify-end' : ''
      }`}
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  );
}

// ─── Section wrapper ──────────────────────────────────────

function CollapsibleSection({
  title,
  count,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between p-4"
        onClick={() => onOpenChange(!open)}
      >
        <span className="text-lg font-semibold text-foreground">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">({count})</span>
        </span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && <CardContent className="px-4 pb-4">{children}</CardContent>}
    </Card>
  );
}

// ─── Accounts Section ─────────────────────────────────────

function AccountsSection() {
  const { accounts, isLoading, createAccount, updateAccount, deleteAccount } = useAccounts();
  type AccountSortKey = 'name' | 'type' | 'balance';

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'asset' | 'liability'>('asset');
  const [balance, setBalance] = useState('');
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'asset' | 'liability'>('asset');

  const [deleteTarget, setDeleteTarget] = useState<AccountWithBalance | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortConfig<AccountSortKey>>({
    key: 'name',
    direction: 'asc',
  });

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      let result = 0;

      if (sort.key === 'name') {
        result = compareText(a.name, b.name);
      } else if (sort.key === 'type') {
        result = compareText(a.type, b.type);
      } else {
        result = a.current_balance - b.current_balance;
      }

      return applySortDirection(result, sort.direction);
    });
  }, [accounts, sort]);

  const selectableIds = useMemo(() => sortedAccounts.map((a) => a.id), [sortedAccounts]);
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const focusedAccount = sortedAccounts.find((account) => account.id === focusedId) ?? sortedAccounts[0] ?? null;

  useShortcutScope('setupAccounts');

  async function submitAddAccount() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createAccount.mutateAsync({
        name: name.trim(),
        type,
        initial_balance: balance ? parseFloat(balance) : 0,
      });
      toast.success('Account created');
      setName('');
      setBalance('');
      setType('asset');
      setShowAdd(false);
    } catch {
      toast.error('Failed to create account');
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await submitAddAccount();
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updateAccount.mutateAsync({ id, name: editName.trim(), type: editType });
      toast.success('Account updated');
      setEditId(null);
    } catch {
      toast.error('Failed to update account');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAccount.mutateAsync(deleteTarget.id);
      toast.success('Account deleted');
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(deleteTarget.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete account');
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteAccount.mutateAsync(id)));
      const deletedIds = new Set(
        ids.filter((_, index) => results[index]?.status === 'fulfilled')
      );

      setSelectedIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });

      if (deletedIds.size === ids.length) {
        toast.success(`${deletedIds.size} accounts deleted`);
        setShowBulkDelete(false);
      } else if (deletedIds.size > 0) {
        toast.warning(`${deletedIds.size} accounts deleted; ${ids.length - deletedIds.size} failed`);
        setShowBulkDelete(false);
      } else {
        toast.error('Failed to delete selected accounts');
      }
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(a: AccountWithBalance) {
    setEditId(a.id);
    setEditName(a.name);
    setEditType(a.type);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllSelected() {
    setSelectedIds((current) => {
      if (allSelected) {
        const next = new Set(current);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...current, ...selectableIds]);
    });
  }

  const cancelAccountForm = useCallback(() => {
    setShowAdd(false);
    setEditId(null);
  }, []);

  useShortcut('setup.accounts.add', useCallback(() => setShowAdd(true), []));
  useShortcut('setup.accounts.save', () => {
    if (showAdd) {
      void submitAddAccount();
    } else if (editId) {
      void handleUpdate(editId);
    }
  });
  useShortcut('setup.accounts.cancel', cancelAccountForm, { enabled: showAdd || editId !== null });
  useShortcut('setup.accounts.editFocused', useCallback(() => {
    if (focusedAccount) startEdit(focusedAccount);
  }, [focusedAccount]));
  useShortcut('setup.accounts.deleteFocused', useCallback(() => {
    if (focusedAccount) setDeleteTarget(focusedAccount);
  }, [focusedAccount]));
  useShortcut('setup.accounts.bulkDelete', useCallback(() => setShowBulkDelete(true), []), { enabled: selectedCount > 0 });
  useShortcut('setup.accounts.selectAll', toggleAllSelected);
  useShortcut('setup.accounts.toggleFocused', useCallback(() => {
    if (focusedAccount) toggleSelected(focusedAccount.id);
  }, [focusedAccount]));
  useShortcut('setup.accounts.sortName', useCallback(() => setSort((current) => nextSort(current, 'name')), []));
  useShortcut('setup.accounts.sortType', useCallback(() => setSort((current) => nextSort(current, 'type')), []));
  useShortcut('setup.accounts.sortBalance', useCallback(() => setSort((current) => nextSort(current, 'balance')), []));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <>
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selectedCount} account{selectedCount === 1 ? '' : 's'} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7"
            onClick={() => setShowBulkDelete(true)}
          >
            <Trash2 size={14} className="mr-1" /> Delete Selected
            <ShortcutHint commandId="setup.accounts.bulkDelete" />
          </Button>
        </div>
      )}
      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-8 pb-1 font-medium">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={selectableIds.length === 0}
                onChange={toggleAllSelected}
                aria-label="Select all accounts"
                className="h-4 w-4 rounded border-border bg-background"
              />
            </th>
            <th className="pb-1 font-medium">
              <SortHeader
                label="Name"
                sortKey="name"
                sort={sort}
                onSort={(key) => setSort((current) => nextSort(current, key))}
              />
            </th>
            <th className="pb-1 font-medium">
              <SortHeader
                label="Type"
                sortKey="type"
                sort={sort}
                onSort={(key) => setSort((current) => nextSort(current, key))}
              />
            </th>
            <th className="pb-1 text-right font-medium">
              <SortHeader
                label="Balance"
                sortKey="balance"
                sort={sort}
                align="right"
                onSort={(key) => setSort((current) => nextSort(current, key))}
              />
            </th>
            <th className="pb-1 text-right font-medium w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedAccounts.map((a) => (
            <tr
              key={a.id}
              tabIndex={0}
              onFocus={() => setFocusedId(a.id)}
              className={`border-b border-border/50 outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                focusedId === a.id ? 'bg-secondary/20' : ''
              }`}
            >
              {editId === a.id ? (
                <>
                  <td className="py-1.5" />
                  <td className="py-1.5 pr-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-7 text-sm"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <SimpleSelect
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as 'asset' | 'liability')}
                      options={[
                        { value: 'asset', label: 'Asset' },
                        { value: 'liability', label: 'Liability' },
                      ]}
                      className="h-7 text-sm"
                    />
                  </td>
                  <td className="py-1.5 text-right">{formatCurrency(a.current_balance)}</td>
                  <td className="py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" className="h-6 px-2 text-xs" onClick={() => handleUpdate(a.id)} loading={saving}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleSelected(a.id)}
                      aria-label={`Select ${a.name}`}
                      className="h-4 w-4 rounded border-border bg-background"
                    />
                  </td>
                  <td className="py-1.5">{a.name}</td>
                  <td className="py-1.5"><TypeBadge type={a.type} /></td>
                  <td className="py-1.5 text-right font-mono">{formatCurrency(a.current_balance)}</td>
                  <td className="py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => startEdit(a)} className="p-1 text-muted-foreground hover:text-foreground">
                        <Pencil size={14} />
                      </button>
                      <button type="button" onClick={() => setDeleteTarget(a)} className="p-1 text-muted-foreground hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add form */}
      {showAdd ? (
        <form onSubmit={handleAdd} className="mt-3 flex items-end gap-2">
          <Input
            placeholder="Account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
          />
          <SimpleSelect
            value={type}
            onChange={(e) => setType(e.target.value as 'asset' | 'liability')}
            options={[
              { value: 'asset', label: 'Asset' },
              { value: 'liability', label: 'Liability' },
            ]}
            className="h-8 w-36 text-sm"
          />
          <Input
            placeholder="Initial balance"
            type="number"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="h-8 w-36 text-sm"
          />
          <Button type="submit" size="sm" className="h-8" loading={saving}>Add</Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setShowAdd(false)}>Cancel</Button>
        </form>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={14} className="mr-1" /> Add Account
          <ShortcutHint commandId="setup.accounts.add" />
        </Button>
      )}

      {/* Delete modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Account"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        isLoading={deleting}
      />
      <ConfirmDeleteModal
        isOpen={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Accounts"
        message={`Delete ${selectedCount} selected account${selectedCount === 1 ? '' : 's'}? This cannot be undone.`}
        isLoading={deleting}
      />
    </>
  );
}

// ─── Categories Section ───────────────────────────────────

function CategoriesSection() {
  const { categories, isLoading, createCategory, updateCategory, deleteCategory } = useCategories();
  type CategorySortKey = 'name' | 'type';

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'income' | 'expense'>('expense');

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortConfig<CategorySortKey>>({
    key: 'name',
    direction: 'asc',
  });

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      const result =
        sort.key === 'name' ? compareText(a.name, b.name) : compareText(a.type, b.type);
      return applySortDirection(result, sort.direction);
    });
  }, [categories, sort]);

  const selectableIds = useMemo(
    () => sortedCategories.filter((c) => !c.is_system).map((c) => c.id),
    [sortedCategories]
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const focusedCategory = sortedCategories.find((category) => category.id === focusedId) ?? sortedCategories.find((category) => !category.is_system) ?? null;

  useShortcutScope('setupCategories');

  async function submitAddCategory() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCategory.mutateAsync({ name: name.trim(), type });
      toast.success('Category created');
      setName('');
      setType('expense');
      setShowAdd(false);
    } catch {
      toast.error('Failed to create category');
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await submitAddCategory();
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updateCategory.mutateAsync({ id, name: editName.trim(), type: editType });
      toast.success('Category updated');
      setEditId(null);
    } catch {
      toast.error('Failed to update category');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCategory.mutateAsync(deleteTarget.id);
      toast.success('Category deleted');
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(deleteTarget.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete category');
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteCategory.mutateAsync(id)));
      const deletedIds = new Set(
        ids.filter((_, index) => results[index]?.status === 'fulfilled')
      );

      setSelectedIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });

      if (deletedIds.size === ids.length) {
        toast.success(`${deletedIds.size} categories deleted`);
        setShowBulkDelete(false);
      } else if (deletedIds.size > 0) {
        toast.warning(`${deletedIds.size} categories deleted; ${ids.length - deletedIds.size} failed`);
        setShowBulkDelete(false);
      } else {
        toast.error('Failed to delete selected categories');
      }
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(c: Category) {
    setEditId(c.id);
    setEditName(c.name);
    setEditType(c.type);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllSelected() {
    setSelectedIds((current) => {
      if (allSelected) {
        const next = new Set(current);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...current, ...selectableIds]);
    });
  }

  const cancelCategoryForm = useCallback(() => {
    setShowAdd(false);
    setEditId(null);
  }, []);

  useShortcut('setup.categories.add', useCallback(() => setShowAdd(true), []));
  useShortcut('setup.categories.save', () => {
    if (showAdd) {
      void submitAddCategory();
    } else if (editId) {
      void handleUpdate(editId);
    }
  });
  useShortcut('setup.categories.cancel', cancelCategoryForm, { enabled: showAdd || editId !== null });
  useShortcut('setup.categories.editFocused', useCallback(() => {
    if (focusedCategory && !focusedCategory.is_system) startEdit(focusedCategory);
  }, [focusedCategory]));
  useShortcut('setup.categories.deleteFocused', useCallback(() => {
    if (focusedCategory && !focusedCategory.is_system) setDeleteTarget(focusedCategory);
  }, [focusedCategory]));
  useShortcut('setup.categories.bulkDelete', useCallback(() => setShowBulkDelete(true), []), { enabled: selectedCount > 0 });
  useShortcut('setup.categories.selectAll', toggleAllSelected);
  useShortcut('setup.categories.toggleFocused', useCallback(() => {
    if (focusedCategory && !focusedCategory.is_system) toggleSelected(focusedCategory.id);
  }, [focusedCategory]));
  useShortcut('setup.categories.sortName', useCallback(() => setSort((current) => nextSort(current, 'name')), []));
  useShortcut('setup.categories.sortType', useCallback(() => setSort((current) => nextSort(current, 'type')), []));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <>
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selectedCount} categor{selectedCount === 1 ? 'y' : 'ies'} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7"
            onClick={() => setShowBulkDelete(true)}
          >
            <Trash2 size={14} className="mr-1" /> Delete Selected
            <ShortcutHint commandId="setup.categories.bulkDelete" />
          </Button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-8 pb-1 font-medium">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={selectableIds.length === 0}
                onChange={toggleAllSelected}
                aria-label="Select all categories"
                className="h-4 w-4 rounded border-border bg-background"
              />
            </th>
            <th className="pb-1 font-medium">
              <SortHeader
                label="Name"
                sortKey="name"
                sort={sort}
                onSort={(key) => setSort((current) => nextSort(current, key))}
              />
            </th>
            <th className="pb-1 font-medium">
              <SortHeader
                label="Type"
                sortKey="type"
                sort={sort}
                onSort={(key) => setSort((current) => nextSort(current, key))}
              />
            </th>
            <th className="pb-1 text-right font-medium w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedCategories.map((c) => (
            <tr
              key={c.id}
              tabIndex={0}
              onFocus={() => setFocusedId(c.id)}
              className={`border-b border-border/50 outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                focusedId === c.id ? 'bg-secondary/20' : ''
              }`}
            >
              {editId === c.id ? (
                <>
                  <td className="py-1.5" />
                  <td className="py-1.5 pr-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-7 text-sm"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <SimpleSelect
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as 'income' | 'expense')}
                      options={[
                        { value: 'income', label: 'Income' },
                        { value: 'expense', label: 'Expense' },
                      ]}
                      className="h-7 text-sm"
                    />
                  </td>
                  <td className="py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" className="h-6 px-2 text-xs" onClick={() => handleUpdate(c.id)} loading={saving}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-1.5">
                    {!c.is_system && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelected(c.id)}
                        aria-label={`Select ${c.name}`}
                        className="h-4 w-4 rounded border-border bg-background"
                      />
                    )}
                  </td>
                  <td className="py-1.5">
                    {c.name}
                    {c.is_system && <Lock size={12} className="ml-1.5 inline text-muted-foreground" />}
                  </td>
                  <td className="py-1.5"><TypeBadge type={c.type} /></td>
                  <td className="py-1.5 text-right">
                    {!c.is_system && (
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => startEdit(c)} className="p-1 text-muted-foreground hover:text-foreground">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => setDeleteTarget(c)} className="p-1 text-muted-foreground hover:text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {showAdd ? (
        <form onSubmit={handleAdd} className="mt-3 flex items-end gap-2">
          <Input
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
          />
          <SimpleSelect
            value={type}
            onChange={(e) => setType(e.target.value as 'income' | 'expense')}
            options={[
              { value: 'income', label: 'Income' },
              { value: 'expense', label: 'Expense' },
            ]}
            className="h-8 w-36 text-sm"
          />
          <Button type="submit" size="sm" className="h-8" loading={saving}>Add</Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setShowAdd(false)}>Cancel</Button>
        </form>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={14} className="mr-1" /> Add Category
          <ShortcutHint commandId="setup.categories.add" />
        </Button>
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Category"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? All subcategories under it will also be removed.`}
        isLoading={deleting}
      />
      <ConfirmDeleteModal
        isOpen={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Categories"
        message={`Delete ${selectedCount} selected categor${selectedCount === 1 ? 'y' : 'ies'}? All subcategories under them will also be removed.`}
        isLoading={deleting}
      />
    </>
  );
}

// ─── Subcategories Section ────────────────────────────────

function SubcategoriesSection() {
  const {
    categories,
    subcategories,
    isLoading,
    createSubcategory,
    updateSubcategory,
    deleteSubcategory,
  } = useCategories();
  type SubcategorySortKey = 'name' | 'category' | 'monthlyGoal';

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [goal, setGoal] = useState('');
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editGoal, setEditGoal] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Subcategory | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortConfig<SubcategorySortKey>>({
    key: 'name',
    direction: 'asc',
  });

  const categoryOptions = categories.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.type})`,
  }));

  const sortedSubcategories = useMemo(() => {
    return [...subcategories].sort((a, b) => {
      const categoryA = categoryMap.get(a.category_id);
      const categoryB = categoryMap.get(b.category_id);
      let result = 0;

      if (sort.key === 'name') {
        result = compareText(a.name, b.name);
      } else if (sort.key === 'category') {
        result = compareText(categoryA?.name ?? '', categoryB?.name ?? '');
      } else {
        const goalA = a.monthly_goal ?? Number.POSITIVE_INFINITY;
        const goalB = b.monthly_goal ?? Number.POSITIVE_INFINITY;
        result = goalA - goalB;
      }

      return applySortDirection(result, sort.direction);
    });
  }, [categoryMap, sort, subcategories]);

  const selectableIds = useMemo(
    () => sortedSubcategories.filter((s) => !s.is_system).map((s) => s.id),
    [sortedSubcategories]
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const focusedSubcategory = sortedSubcategories.find((subcategory) => subcategory.id === focusedId) ?? sortedSubcategories.find((subcategory) => !subcategory.is_system) ?? null;

  useShortcutScope('setupSubcategories');

  async function submitAddSubcategory() {
    if (!name.trim() || !categoryId) return;
    setSaving(true);
    try {
      await createSubcategory.mutateAsync({
        name: name.trim(),
        category_id: categoryId,
        monthly_goal: goal ? parseFloat(goal) : null,
      });
      toast.success('Subcategory created');
      setName('');
      setCategoryId('');
      setGoal('');
      setShowAdd(false);
    } catch {
      toast.error('Failed to create subcategory');
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await submitAddSubcategory();
  }

  async function handleUpdate(id: string) {
    if (!editName.trim() || !editCategoryId) return;
    setSaving(true);
    try {
      await updateSubcategory.mutateAsync({
        id,
        name: editName.trim(),
        category_id: editCategoryId,
        monthly_goal: editGoal ? parseFloat(editGoal) : null,
      });
      toast.success('Subcategory updated');
      setEditId(null);
    } catch {
      toast.error('Failed to update subcategory');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSubcategory.mutateAsync(deleteTarget.id);
      toast.success('Subcategory deleted');
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(deleteTarget.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete subcategory');
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteSubcategory.mutateAsync(id)));
      const deletedIds = new Set(
        ids.filter((_, index) => results[index]?.status === 'fulfilled')
      );

      setSelectedIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });

      if (deletedIds.size === ids.length) {
        toast.success(`${deletedIds.size} subcategories deleted`);
        setShowBulkDelete(false);
      } else if (deletedIds.size > 0) {
        toast.warning(`${deletedIds.size} subcategories deleted; ${ids.length - deletedIds.size} failed`);
        setShowBulkDelete(false);
      } else {
        toast.error('Failed to delete selected subcategories');
      }
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(s: Subcategory) {
    setEditId(s.id);
    setEditName(s.name);
    setEditCategoryId(s.category_id);
    setEditGoal(s.monthly_goal != null ? String(s.monthly_goal) : '');
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllSelected() {
    setSelectedIds((current) => {
      if (allSelected) {
        const next = new Set(current);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...current, ...selectableIds]);
    });
  }

  const cancelSubcategoryForm = useCallback(() => {
    setShowAdd(false);
    setEditId(null);
  }, []);

  useShortcut('setup.subcategories.add', useCallback(() => setShowAdd(true), []));
  useShortcut('setup.subcategories.save', () => {
    if (showAdd) {
      void submitAddSubcategory();
    } else if (editId) {
      void handleUpdate(editId);
    }
  });
  useShortcut('setup.subcategories.cancel', cancelSubcategoryForm, { enabled: showAdd || editId !== null });
  useShortcut('setup.subcategories.editFocused', useCallback(() => {
    if (focusedSubcategory && !focusedSubcategory.is_system) startEdit(focusedSubcategory);
  }, [focusedSubcategory]));
  useShortcut('setup.subcategories.deleteFocused', useCallback(() => {
    if (focusedSubcategory && !focusedSubcategory.is_system) setDeleteTarget(focusedSubcategory);
  }, [focusedSubcategory]));
  useShortcut('setup.subcategories.bulkDelete', useCallback(() => setShowBulkDelete(true), []), { enabled: selectedCount > 0 });
  useShortcut('setup.subcategories.selectAll', toggleAllSelected);
  useShortcut('setup.subcategories.toggleFocused', useCallback(() => {
    if (focusedSubcategory && !focusedSubcategory.is_system) toggleSelected(focusedSubcategory.id);
  }, [focusedSubcategory]));
  useShortcut('setup.subcategories.sortName', useCallback(() => setSort((current) => nextSort(current, 'name')), []));
  useShortcut('setup.subcategories.sortCategory', useCallback(() => setSort((current) => nextSort(current, 'category')), []));
  useShortcut('setup.subcategories.sortGoal', useCallback(() => setSort((current) => nextSort(current, 'monthlyGoal')), []));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <>
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selectedCount} subcategor{selectedCount === 1 ? 'y' : 'ies'} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7"
            onClick={() => setShowBulkDelete(true)}
          >
            <Trash2 size={14} className="mr-1" /> Delete Selected
            <ShortcutHint commandId="setup.subcategories.bulkDelete" />
          </Button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-8 pb-1 font-medium">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={selectableIds.length === 0}
                onChange={toggleAllSelected}
                aria-label="Select all subcategories"
                className="h-4 w-4 rounded border-border bg-background"
              />
            </th>
            <th className="pb-1 font-medium">
              <SortHeader
                label="Name"
                sortKey="name"
                sort={sort}
                onSort={(key) => setSort((current) => nextSort(current, key))}
              />
            </th>
            <th className="pb-1 font-medium">
              <SortHeader
                label="Category"
                sortKey="category"
                sort={sort}
                onSort={(key) => setSort((current) => nextSort(current, key))}
              />
            </th>
            <th className="pb-1 text-right font-medium">
              <SortHeader
                label="Monthly Goal"
                sortKey="monthlyGoal"
                sort={sort}
                align="right"
                onSort={(key) => setSort((current) => nextSort(current, key))}
              />
            </th>
            <th className="pb-1 text-right font-medium w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedSubcategories.map((s) => {
            const parentCat = categoryMap.get(s.category_id);
            return (
              <tr
                key={s.id}
                tabIndex={0}
                onFocus={() => setFocusedId(s.id)}
                className={`border-b border-border/50 outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                  focusedId === s.id ? 'bg-secondary/20' : ''
                }`}
              >
                {editId === s.id ? (
                  <>
                    <td className="py-1.5" />
                    <td className="py-1.5 pr-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <SimpleSelect
                        value={editCategoryId}
                        onChange={(e) => setEditCategoryId(e.target.value)}
                        options={categoryOptions}
                        className="h-7 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="None"
                        value={editGoal}
                        onChange={(e) => setEditGoal(e.target.value)}
                        className="h-7 text-right text-sm"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" className="h-6 px-2 text-xs" onClick={() => handleUpdate(s.id)} loading={saving}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-1.5">
                      {!s.is_system && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelected(s.id)}
                          aria-label={`Select ${s.name}`}
                          className="h-4 w-4 rounded border-border bg-background"
                        />
                      )}
                    </td>
                    <td className="py-1.5">
                      {s.name}
                      {s.is_system && <Lock size={12} className="ml-1.5 inline text-muted-foreground" />}
                    </td>
                    <td className="py-1.5">
                      {parentCat ? (
                        <>
                          {parentCat.name} <TypeBadge type={parentCat.type} />
                        </>
                      ) : (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {s.monthly_goal != null ? formatCurrency(s.monthly_goal) : <span className="text-muted-foreground">--</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      {!s.is_system && (
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => startEdit(s)} className="p-1 text-muted-foreground hover:text-foreground">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(s)} className="p-1 text-muted-foreground hover:text-red-400">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {showAdd ? (
        <form onSubmit={handleAdd} className="mt-3 flex items-end gap-2">
          <Input
            placeholder="Subcategory name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
          />
          <SimpleSelect
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={categoryOptions}
            placeholder="Select category"
            className="h-8 w-48 text-sm"
          />
          <Input
            placeholder="Monthly goal"
            type="number"
            step="0.01"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="h-8 w-36 text-sm"
          />
          <Button type="submit" size="sm" className="h-8" loading={saving}>Add</Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setShowAdd(false)}>Cancel</Button>
        </form>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={14} className="mr-1" /> Add Subcategory
          <ShortcutHint commandId="setup.subcategories.add" />
        </Button>
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Subcategory"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        isLoading={deleting}
      />
      <ConfirmDeleteModal
        isOpen={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Subcategories"
        message={`Delete ${selectedCount} selected subcategor${selectedCount === 1 ? 'y' : 'ies'}? This cannot be undone.`}
        isLoading={deleting}
      />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────

export function SetupPage() {
  const { accounts } = useAccounts();
  const { categories, subcategories } = useCategories();
  const [accountsOpen, setAccountsOpen] = useState(true);
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [subcategoriesOpen, setSubcategoriesOpen] = useState(true);

  useShortcutScope('setup');
  useShortcut('setup.toggleAccounts', useCallback(() => setAccountsOpen((open) => !open), []));
  useShortcut('setup.toggleCategories', useCallback(() => setCategoriesOpen((open) => !open), []));
  useShortcut('setup.toggleSubcategories', useCallback(() => setSubcategoriesOpen((open) => !open), []));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Setup</h1>

      <CollapsibleSection title="Accounts" count={accounts?.length ?? 0} open={accountsOpen} onOpenChange={setAccountsOpen}>
        <AccountsSection />
      </CollapsibleSection>

      <CollapsibleSection title="Categories" count={categories?.length ?? 0} open={categoriesOpen} onOpenChange={setCategoriesOpen}>
        <CategoriesSection />
      </CollapsibleSection>

      <CollapsibleSection title="Subcategories" count={subcategories?.length ?? 0} open={subcategoriesOpen} onOpenChange={setSubcategoriesOpen}>
        <SubcategoriesSection />
      </CollapsibleSection>
    </div>
  );
}
