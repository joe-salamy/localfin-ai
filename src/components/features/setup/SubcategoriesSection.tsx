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
import type { Subcategory } from "@shared/contracts";
import { useResizableColumns } from "@/features/table-layout/useResizableColumns";
import type { SortConfig } from "@/components/features/setup/setupSort";
import { formatCurrency, SETUP_SUBCATEGORY_COLUMN_DEFS } from "@/components/features/setup/setupShared";
import { TypeBadge } from "@/components/features/setup/TypeBadge";

export function SubcategoriesSection() {
  const {
    categories,
    subcategories,
    isLoading,
    createSubcategory,
    updateSubcategory,
    deleteSubcategory,
    restoreSubcategory,
  } = useCategories();
  const successToast = useSuccessToast();
  const { execute } = useUndoRedo();
  type SubcategorySortKey = "name" | "category" | "monthlyGoal";

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [goal, setGoal] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editGoal, setEditGoal] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Subcategory | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sectionFocused, setSectionFocused] = useState(false);
  const [sort, setSort] = useState<SortConfig<SubcategorySortKey>>({
    key: "name",
    direction: "asc",
  });
  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns("setup.subcategories", SETUP_SUBCATEGORY_COLUMN_DEFS);

  const categoryOptions = categories.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.type})`,
  }));

  const sortedSubcategories = useMemo(() => {
    return [...subcategories].sort((a, b) => {
      const categoryA = categoryMap.get(a.category_id);
      const categoryB = categoryMap.get(b.category_id);
      let result = 0;

      if (sort.key === "name") {
        result = compareText(a.name, b.name);
      } else if (sort.key === "category") {
        result = compareText(categoryA?.name ?? "", categoryB?.name ?? "");
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
    [sortedSubcategories],
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const focusedSubcategory =
    sortedSubcategories.find((subcategory) => subcategory.id === focusedId) ??
    sortedSubcategories.find((subcategory) => !subcategory.is_system) ??
    null;

  useShortcutScope(
    "setupSubcategories",
    sectionFocused || showAdd || editId !== null,
  );

  async function submitAddSubcategory() {
    if (!name.trim() || !categoryId) return;
    const payload = {
      name: name.trim(),
      category_id: categoryId,
      monthly_goal: goal ? parseFloat(goal) : null,
      color,
    };
    let createdId: string | null = null;
    setSaving(true);
    try {
      await execute({
        id: crypto.randomUUID(),
        label: "Create subcategory",
        apply: async () => {
          try {
            const result = await createSubcategory.mutateAsync(payload);
            createdId = result.data?.id ?? null;
            if (!createdId) {
              throw new Error("Subcategory creation returned no subcategory.");
            }
            successToast("Subcategory created");
            setName("");
            setCategoryId("");
            setGoal("");
            setColor(null);
            setShowAdd(false);
          } catch {
            toast.error("Failed to create subcategory");
            throw new Error("Failed to create subcategory");
          }
        },
        undo: async () => {
          if (createdId) await deleteSubcategory.mutateAsync(createdId);
        },
        redo: async () => {
          if (createdId) await restoreSubcategory.mutateAsync(createdId);
        },
      });
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
    const before = subcategories.find((subcategory) => subcategory.id === id);
    const updates = {
      name: editName.trim(),
      category_id: editCategoryId,
      monthly_goal: editGoal ? parseFloat(editGoal) : null,
      color: editColor,
    };
    setSaving(true);
    try {
      if (!before) {
        await updateSubcategory.mutateAsync({ id, ...updates });
      } else {
        const applied = await execute({
          id: crypto.randomUUID(),
          label: "Update subcategory",
          apply: async () => {
            await updateSubcategory.mutateAsync({ id, ...updates });
          },
          undo: async () => {
            await updateSubcategory.mutateAsync({
              id,
              name: before.name,
              category_id: before.category_id,
              monthly_goal: before.monthly_goal,
              color: before.color,
            });
          },
          redo: async () => {
            await updateSubcategory.mutateAsync({ id, ...updates });
          },
        });
        if (!applied) throw new Error("Failed to update subcategory");
      }
      successToast("Subcategory updated");
      setEditId(null);
    } catch {
      toast.error("Failed to update subcategory");
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
        label: "Delete subcategory",
        apply: async () => {
          await deleteSubcategory.mutateAsync(target.id);
        },
        undo: async () => {
          await restoreSubcategory.mutateAsync(target.id);
        },
        redo: async () => {
          await deleteSubcategory.mutateAsync(target.id);
        },
      });
      if (!applied) throw new Error("Failed to delete subcategory");
      successToast("Subcategory deleted");
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete subcategory");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = sortedSubcategories
      .filter(
        (subcategory) =>
          selectedIds.has(subcategory.id) && !subcategory.is_system,
      )
      .map((subcategory) => subcategory.id);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete subcategories",
        apply: async () => {
          for (const id of ids) {
            await deleteSubcategory.mutateAsync(id);
          }
        },
        undo: async () => {
          for (const id of ids) {
            await restoreSubcategory.mutateAsync(id);
          }
        },
        redo: async () => {
          for (const id of ids) {
            await deleteSubcategory.mutateAsync(id);
          }
        },
      });
      if (!applied) throw new Error("Failed to delete selected subcategories");
      setSelectedIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      successToast(`${ids.length} subcategories deleted`);
      setShowBulkDelete(false);
    } catch {
      toast.error("Failed to delete selected subcategories");
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(s: Subcategory) {
    setEditId(s.id);
    setEditName(s.name);
    setEditCategoryId(s.category_id);
    setEditGoal(s.monthly_goal != null ? String(s.monthly_goal) : "");
    setEditColor(s.color);
  }

  async function updateSubcategoryColor(
    subcategory: Subcategory,
    nextColor: string | null,
  ) {
    await execute({
      id: crypto.randomUUID(),
      label: "Update subcategory",
      apply: async () => {
        await updateSubcategory.mutateAsync({
          id: subcategory.id,
          color: nextColor,
        });
      },
      undo: async () => {
        await updateSubcategory.mutateAsync({
          id: subcategory.id,
          name: subcategory.name,
          category_id: subcategory.category_id,
          monthly_goal: subcategory.monthly_goal,
          color: subcategory.color,
        });
      },
      redo: async () => {
        await updateSubcategory.mutateAsync({
          id: subcategory.id,
          color: nextColor,
        });
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

  const cancelSubcategoryForm = useCallback(() => {
    setShowAdd(false);
    setEditId(null);
  }, []);

  useShortcut(
    "setup.subcategories.add",
    useCallback(() => setShowAdd(true), []),
  );
  useShortcut("setup.subcategories.save", () => {
    if (showAdd) {
      void submitAddSubcategory();
    } else if (editId) {
      void handleUpdate(editId);
    }
  });

  function handleSubcategoryEditRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    subcategoryId: string,
  ) {
    if (saving) return;
    handleEnterSave(event, () => {
      void handleUpdate(subcategoryId);
    });
  }
  useShortcut("setup.subcategories.cancel", cancelSubcategoryForm, {
    enabled: showAdd || editId !== null,
  });
  useShortcut(
    "setup.subcategories.editFocused",
    useCallback(() => {
      if (focusedSubcategory && !focusedSubcategory.is_system)
        startEdit(focusedSubcategory);
    }, [focusedSubcategory]),
  );
  useShortcut(
    "setup.subcategories.deleteFocused",
    useCallback(() => {
      if (focusedSubcategory && !focusedSubcategory.is_system)
        setDeleteTarget(focusedSubcategory);
    }, [focusedSubcategory]),
  );
  useShortcut(
    "setup.subcategories.bulkDelete",
    useCallback(() => setShowBulkDelete(true), []),
    { enabled: selectedCount > 0 },
  );
  useShortcut("setup.subcategories.selectAll", toggleAllSelected);
  useShortcut(
    "setup.subcategories.toggleFocused",
    useCallback(() => {
      if (focusedSubcategory && !focusedSubcategory.is_system)
        toggleSelected(focusedSubcategory.id);
    }, [focusedSubcategory]),
  );
  useShortcut(
    "setup.subcategories.sortName",
    useCallback(() => setSort((current) => nextSort(current, "name")), []),
  );
  useShortcut(
    "setup.subcategories.sortCategory",
    useCallback(() => setSort((current) => nextSort(current, "category")), []),
  );
  useShortcut(
    "setup.subcategories.sortGoal",
    useCallback(
      () => setSort((current) => nextSort(current, "monthlyGoal")),
      [],
    ),
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
            {selectedCount} subcategor{selectedCount === 1 ? "y" : "ies"}{" "}
            selected
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
                  aria-label="Select all subcategories"
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
                style={getHeaderStyle("category")}
              >
                <SortHeader
                  label="Category"
                  sortKey="category"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("category")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 text-right font-medium"
                style={getHeaderStyle("monthlyGoal")}
              >
                <SortHeader
                  label="Monthly Goal"
                  sortKey="monthlyGoal"
                  sort={sort}
                  align="right"
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("monthlyGoal")}
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
            {sortedSubcategories.map((s) => {
              const parentCat = categoryMap.get(s.category_id);
              return (
                <tr
                  key={s.id}
                  tabIndex={0}
                  onFocus={() => setFocusedId(s.id)}
                  onKeyDown={
                    editId === s.id
                      ? (event) => handleSubcategoryEditRowKeyDown(event, s.id)
                      : undefined
                  }
                  className={`border-b border-border/50 outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                    focusedId === s.id ? "bg-secondary/20" : ""
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
                      <td className="py-1.5 pr-2">
                        <ColorPicker
                          value={editColor}
                          onChange={setEditColor}
                          label={`${s.name} color`}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => handleUpdate(s.id)}
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
                      <td
                        className="py-1.5"
                        onDoubleClick={(event) => {
                          if (s.is_system) return;
                          if (!shouldHandleFieldEditDoubleClick(event)) return;
                          startEdit(s);
                        }}
                      >
                        <EntityLabel id={s.id} name={s.name} color={s.color} />
                        {s.is_system && (
                          <Lock
                            size={12}
                            className="ml-1.5 inline text-muted-foreground"
                          />
                        )}
                      </td>
                      <td
                        className="py-1.5"
                        onDoubleClick={(event) => {
                          if (s.is_system) return;
                          if (!shouldHandleFieldEditDoubleClick(event)) return;
                          startEdit(s);
                        }}
                      >
                        {parentCat ? (
                          <>
                            <EntityLabel
                              id={parentCat.id}
                              name={parentCat.name}
                              color={parentCat.color}
                            />{" "}
                            <TypeBadge type={parentCat.type} />
                          </>
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                      </td>
                      <td
                        className="py-1.5 text-right font-mono"
                        onDoubleClick={(event) => {
                          if (s.is_system) return;
                          if (!shouldHandleFieldEditDoubleClick(event)) return;
                          startEdit(s);
                        }}
                      >
                        {s.monthly_goal != null ? (
                          formatCurrency(s.monthly_goal)
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </td>
                      <td
                        className="py-1.5"
                        onDoubleClick={(event) => {
                          if (s.is_system) return;
                          if (!shouldHandleFieldEditDoubleClick(event)) return;
                          startEdit(s);
                        }}
                      >
                        <ColorPicker
                          value={s.color}
                          onChange={(nextColor) => {
                            void updateSubcategoryColor(s, nextColor);
                          }}
                          label={`${s.name} color`}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        {!s.is_system && (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(s)}
                              className="p-1 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(s)}
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
              );
            })}
          </tbody>
        </table>
      </div>

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
          <ColorPicker
            value={color}
            onChange={setColor}
            label="New subcategory color"
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
        message={`Delete ${selectedCount} selected subcategor${selectedCount === 1 ? "y" : "ies"}? This cannot be undone.`}
        isLoading={deleting}
      />
    </div>
  );
}
