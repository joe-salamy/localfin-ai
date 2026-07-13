import { useCallback, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SimpleSelect } from "@/components/ui/SimpleSelect";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { ConfirmDeleteModal } from "@/components/features/ConfirmDeleteModal";
import { useCategories } from "@/hooks/useCategories";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";
import { useShortcut, useShortcutScope } from "@/features/shortcuts/hooks";
import { useUndoRedo } from "@/features/undo-redo/hooks";
import { handleEnterSave } from "@/lib/enterSave";
import { shouldHandleFieldEditDoubleClick } from "@/lib/fieldEditDoubleClick";
import { useSuccessToast } from "@/features/display-settings/hooks";
import { SortHeader } from "@/components/features/setup/SetupSection";
import { applySortDirection, compareText, nextSort } from "@/components/features/setup/setupSort";
import type { Category } from "@shared/contracts";
import { useResizableColumns } from "@/features/table-layout/useResizableColumns";
import type { SortConfig } from "@/components/features/setup/setupSort";
import { SETUP_CATEGORY_COLUMN_DEFS } from "@/components/features/setup/setupShared";
import { TypeBadge } from "@/components/features/setup/TypeBadge";

export function CategoriesSection() {
  const {
    categories,
    isLoading,
    createCategory,
    updateCategory,
    deleteCategory,
    restoreCategory,
  } = useCategories();
  const successToast = useSuccessToast();
  const { execute } = useUndoRedo();
  type CategorySortKey = "name" | "type";

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"income" | "expense">("expense");
  const [editColor, setEditColor] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sectionFocused, setSectionFocused] = useState(false);
  const [sort, setSort] = useState<SortConfig<CategorySortKey>>({
    key: "name",
    direction: "asc",
  });
  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns("setup.categories", SETUP_CATEGORY_COLUMN_DEFS);

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      const result =
        sort.key === "name"
          ? compareText(a.name, b.name)
          : compareText(a.type, b.type);
      return applySortDirection(result, sort.direction);
    });
  }, [categories, sort]);

  const selectableIds = useMemo(
    () => sortedCategories.filter((c) => !c.is_system).map((c) => c.id),
    [sortedCategories],
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const focusedCategory =
    sortedCategories.find((category) => category.id === focusedId) ??
    sortedCategories.find((category) => !category.is_system) ??
    null;

  useShortcutScope(
    "setupCategories",
    sectionFocused || showAdd || editId !== null,
  );

  async function submitAddCategory() {
    if (!name.trim()) return;
    const payload = { name: name.trim(), type, color };
    let createdId: string | null = null;
    setSaving(true);
    try {
      await execute({
        id: crypto.randomUUID(),
        label: "Create category",
        apply: async () => {
          try {
            const result = await createCategory.mutateAsync(payload);
            createdId = result.data?.id ?? null;
            if (!createdId)
              throw new Error("Category creation returned no category.");
            successToast("Category created");
            setName("");
            setColor(null);
            setType("expense");
            setShowAdd(false);
          } catch {
            toast.error("Failed to create category");
            throw new Error("Failed to create category");
          }
        },
        undo: async () => {
          if (createdId) await deleteCategory.mutateAsync(createdId);
        },
        redo: async () => {
          if (createdId) await restoreCategory.mutateAsync(createdId);
        },
      });
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
    const before = categories.find((category) => category.id === id);
    const updates = { name: editName.trim(), type: editType, color: editColor };
    setSaving(true);
    try {
      if (!before) {
        await updateCategory.mutateAsync({ id, ...updates });
      } else {
        const applied = await execute({
          id: crypto.randomUUID(),
          label: "Update category",
          apply: async () => {
            await updateCategory.mutateAsync({ id, ...updates });
          },
          undo: async () => {
            await updateCategory.mutateAsync({
              id,
              name: before.name,
              type: before.type,
              color: before.color,
            });
          },
          redo: async () => {
            await updateCategory.mutateAsync({ id, ...updates });
          },
        });
        if (!applied) throw new Error("Failed to update category");
      }
      successToast("Category updated");
      setEditId(null);
    } catch {
      toast.error("Failed to update category");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete category",
        apply: async () => {
          await deleteCategory.mutateAsync(target.id);
        },
        undo: async () => {
          await restoreCategory.mutateAsync(target.id);
        },
        redo: async () => {
          await deleteCategory.mutateAsync(target.id);
        },
      });
      if (!applied) throw new Error("Failed to delete category");
      successToast("Category deleted");
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete category");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = sortedCategories
      .filter((category) => selectedIds.has(category.id) && !category.is_system)
      .map((category) => category.id);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete categories",
        apply: async () => {
          for (const id of ids) {
            await deleteCategory.mutateAsync(id);
          }
        },
        undo: async () => {
          for (const id of ids) {
            await restoreCategory.mutateAsync(id);
          }
        },
        redo: async () => {
          for (const id of ids) {
            await deleteCategory.mutateAsync(id);
          }
        },
      });
      if (!applied) throw new Error("Failed to delete selected categories");
      setSelectedIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      successToast(`${ids.length} categories deleted`);
      setShowBulkDelete(false);
    } catch {
      toast.error("Failed to delete selected categories");
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(c: Category) {
    setEditId(c.id);
    setEditName(c.name);
    setEditType(c.type);
    setEditColor(c.color);
  }

  async function updateCategoryColor(
    category: Category,
    nextColor: string | null,
  ) {
    await execute({
      id: crypto.randomUUID(),
      label: "Update category",
      apply: async () => {
        await updateCategory.mutateAsync({ id: category.id, color: nextColor });
      },
      undo: async () => {
        await updateCategory.mutateAsync({
          id: category.id,
          name: category.name,
          type: category.type,
          color: category.color,
        });
      },
      redo: async () => {
        await updateCategory.mutateAsync({ id: category.id, color: nextColor });
      },
    });
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

  useShortcut(
    "setup.categories.add",
    useCallback(() => setShowAdd(true), []),
  );
  useShortcut("setup.categories.save", () => {
    if (showAdd) {
      void submitAddCategory();
    } else if (editId) {
      void handleUpdate(editId);
    }
  });

  function handleCategoryEditRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    categoryId: string,
  ) {
    if (saving) return;
    handleEnterSave(event, () => {
      void handleUpdate(categoryId);
    });
  }
  useShortcut("setup.categories.cancel", cancelCategoryForm, {
    enabled: showAdd || editId !== null,
  });
  useShortcut(
    "setup.categories.editFocused",
    useCallback(() => {
      if (focusedCategory && !focusedCategory.is_system)
        startEdit(focusedCategory);
    }, [focusedCategory]),
  );
  useShortcut(
    "setup.categories.deleteFocused",
    useCallback(() => {
      if (focusedCategory && !focusedCategory.is_system)
        setDeleteTarget(focusedCategory);
    }, [focusedCategory]),
  );
  useShortcut(
    "setup.categories.bulkDelete",
    useCallback(() => setShowBulkDelete(true), []),
    { enabled: selectedCount > 0 },
  );
  useShortcut("setup.categories.selectAll", toggleAllSelected);
  useShortcut(
    "setup.categories.toggleFocused",
    useCallback(() => {
      if (focusedCategory && !focusedCategory.is_system)
        toggleSelected(focusedCategory.id);
    }, [focusedCategory]),
  );
  useShortcut(
    "setup.categories.sortName",
    useCallback(() => setSort((current) => nextSort(current, "name")), []),
  );
  useShortcut(
    "setup.categories.sortType",
    useCallback(() => setSort((current) => nextSort(current, "type")), []),
  );

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div
      onFocus={() => setSectionFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setSectionFocused(false);
        }
      }}
    >
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selectedCount} categor{selectedCount === 1 ? "y" : "ies"} selected
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
      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          style={{ minWidth: totalWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={getColStyle(column.id)} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("select")}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={selectableIds.length === 0}
                  onChange={toggleAllSelected}
                  aria-label="Select all categories"
                  className="h-4 w-4 rounded border-border bg-background"
                />
                <span
                  {...getResizeHandleProps("select")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("name")}
              >
                <SortHeader
                  label="Name"
                  sortKey="name"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("name")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("type")}
              >
                <SortHeader
                  label="Type"
                  sortKey="type"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("type")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("color")}
              >
                Color
                <span
                  {...getResizeHandleProps("color")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 text-right font-medium"
                style={getHeaderStyle("actions")}
              >
                Actions
                <span
                  {...getResizeHandleProps("actions")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedCategories.map((c) => (
              <tr
                key={c.id}
                tabIndex={0}
                onKeyDown={
                  editId === c.id
                    ? (event) => handleCategoryEditRowKeyDown(event, c.id)
                    : undefined
                }
                onFocus={() => setFocusedId(c.id)}
                className={`border-b border-border/50 outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                  focusedId === c.id ? "bg-secondary/20" : ""
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
                        onChange={(e) =>
                          setEditType(e.target.value as "income" | "expense")
                        }
                        options={[
                          { value: "income", label: "Income" },
                          { value: "expense", label: "Expense" },
                        ]}
                        className="h-7 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <ColorPicker
                        value={editColor}
                        onChange={setEditColor}
                        label={`${c.name} color`}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleUpdate(c.id)}
                          loading={saving}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => setEditId(null)}
                        >
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
                    <td
                      className="py-1.5"
                      onDoubleClick={(event) => {
                        if (c.is_system) return;
                        if (!shouldHandleFieldEditDoubleClick(event)) return;
                        startEdit(c);
                      }}
                    >
                      <EntityLabel id={c.id} name={c.name} color={c.color} />
                      {c.is_system && (
                        <Lock
                          size={12}
                          className="ml-1.5 inline text-muted-foreground"
                        />
                      )}
                    </td>
                    <td
                      className="py-1.5"
                      onDoubleClick={(event) => {
                        if (c.is_system) return;
                        if (!shouldHandleFieldEditDoubleClick(event)) return;
                        startEdit(c);
                      }}
                    >
                      <TypeBadge type={c.type} />
                    </td>
                    <td
                      className="py-1.5"
                      onDoubleClick={(event) => {
                        if (c.is_system) return;
                        if (!shouldHandleFieldEditDoubleClick(event)) return;
                        startEdit(c);
                      }}
                    >
                      <ColorPicker
                        value={c.color}
                        onChange={(nextColor) => {
                          void updateCategoryColor(c, nextColor);
                        }}
                        label={`${c.name} color`}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      {!c.is_system && (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(c)}
                            className="p-1 text-muted-foreground hover:text-red-400"
                          >
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
      </div>

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
            onChange={(e) => setType(e.target.value as "income" | "expense")}
            options={[
              { value: "income", label: "Income" },
              { value: "expense", label: "Expense" },
            ]}
            className="h-8 w-36 text-sm"
          />
          <ColorPicker
            value={color}
            onChange={setColor}
            label="New category color"
          />
          <Button type="submit" size="sm" className="h-8" loading={saving}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setShowAdd(false)}
          >
            Cancel
          </Button>
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
        message={`Delete ${selectedCount} selected categor${selectedCount === 1 ? "y" : "ies"}? All subcategories under them will also be removed.`}
        isLoading={deleting}
      />
    </div>
  );
}
