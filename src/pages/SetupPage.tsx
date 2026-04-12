import { useState } from 'react';
import type { FormEvent } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus, Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SimpleSelect } from '@/components/ui/SimpleSelect';
import { ConfirmDeleteModal } from '@/components/features/ConfirmDeleteModal';
import { useAccounts } from '@/hooks/useAccounts';
import { useCategories } from '@/hooks/useCategories';
import type { AccountWithBalance, Category, Subcategory } from '@/types';

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

// ─── Section wrapper ──────────────────────────────────────

function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between p-4"
        onClick={() => setOpen(!open)}
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

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'asset' | 'liability'>('asset');
  const [balance, setBalance] = useState('');
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'asset' | 'liability'>('asset');

  const [deleteTarget, setDeleteTarget] = useState<AccountWithBalance | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
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
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete account');
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(a: AccountWithBalance) {
    setEditId(a.id);
    setEditName(a.name);
    setEditType(a.type);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <>
      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-1 font-medium">Name</th>
            <th className="pb-1 font-medium">Type</th>
            <th className="pb-1 text-right font-medium">Balance</th>
            <th className="pb-1 text-right font-medium w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className="border-b border-border/50">
              {editId === a.id ? (
                <>
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
    </>
  );
}

// ─── Categories Section ───────────────────────────────────

function CategoriesSection() {
  const { categories, isLoading, createCategory, updateCategory, deleteCategory } = useCategories();

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'income' | 'expense'>('expense');

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
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
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete category');
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(c: Category) {
    setEditId(c.id);
    setEditName(c.name);
    setEditType(c.type);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-1 font-medium">Name</th>
            <th className="pb-1 font-medium">Type</th>
            <th className="pb-1 text-right font-medium w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id} className="border-b border-border/50">
              {editId === c.id ? (
                <>
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

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

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
  const [deleting, setDeleting] = useState(false);

  const categoryOptions = categories.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.type})`,
  }));

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
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
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete subcategory');
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-1 font-medium">Name</th>
            <th className="pb-1 font-medium">Category</th>
            <th className="pb-1 text-right font-medium">Monthly Goal</th>
            <th className="pb-1 text-right font-medium w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {subcategories.map((s) => {
            const parentCat = categoryMap.get(s.category_id);
            return (
              <tr key={s.id} className="border-b border-border/50">
                {editId === s.id ? (
                  <>
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
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────

export function SetupPage() {
  const { accounts } = useAccounts();
  const { categories, subcategories } = useCategories();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Setup</h1>

      <CollapsibleSection title="Accounts" count={accounts?.length ?? 0}>
        <AccountsSection />
      </CollapsibleSection>

      <CollapsibleSection title="Categories" count={categories?.length ?? 0}>
        <CategoriesSection />
      </CollapsibleSection>

      <CollapsibleSection title="Subcategories" count={subcategories?.length ?? 0}>
        <SubcategoriesSection />
      </CollapsibleSection>
    </div>
  );
}
