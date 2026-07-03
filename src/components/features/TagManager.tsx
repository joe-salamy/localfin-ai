import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { Pencil, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { SimpleSelect } from "@/components/ui/SimpleSelect";
import { ConfirmDeleteModal } from "@/components/features/ConfirmDeleteModal";
import { TagChip } from "@/components/features/TagPicker";
import { useTags } from "@/hooks/useTags";
import { useUndoRedo } from "@/features/undo-redo/hooks";
import { resolveEntityColor } from "@/lib/colors";
import { handleEnterSave } from "@/lib/enterSave";
import type { Tag, TagType } from "@/types";
import {
  useResizableColumns,
  type ResizableColumnDef,
} from "@/features/table-layout/useResizableColumns";
import { useSuccessToast } from "@/features/display-settings/hooks";

const TAG_TYPES: TagType[] = [
  "custom",
  "trip",
  "event",
  "person",
  "reimbursable",
  "tax",
];
const tagTypeOptions = TAG_TYPES.map((type) => ({
  value: type,
  label: type.charAt(0).toUpperCase() + type.slice(1),
}));

const TAG_COLUMNS: ResizableColumnDef[] = [
  { id: "tag", defaultWidth: 220 },
  { id: "type", defaultWidth: 112 },
  { id: "color", defaultWidth: 96 },
  { id: "actions", defaultWidth: 96 },
];

export function TagManager() {
  const { tags, isLoading, createTag, updateTag, deleteTag, restoreTag } =
    useTags();
  const { execute } = useUndoRedo();
  const successToast = useSuccessToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<TagType>("custom");
  const [color, setColor] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<TagType>("custom");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);

  const sortedTags = useMemo(
    () =>
      [...tags]
        .filter((tag) => !tag.deleted_at)
        .sort(
          (a, b) =>
            a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
        ),
    [tags],
  );

  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns("setup.tags", TAG_COLUMNS);

  const startEdit = (tag: Tag) => {
    setEditId(tag.id);
    setEditName(tag.name);
    setEditType(tag.type);
    setEditColor(tag.color);
  };

  const create = async () => {
    const nextName = name.trim().replace(/\s+/g, " ");
    if (!nextName) {
      toast.error("Tag name is required");
      return;
    }

    let createdId: string | null = null;
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Create tag",
        apply: async () => {
          try {
            const result = await createTag.mutateAsync({
              name: nextName,
              type,
              color,
            });
            createdId = result.data?.id ?? null;
            if (!createdId) throw new Error("Tag creation returned no tag.");
            successToast("Tag created");
            setName("");
            setType("custom");
            setColor(null);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to create tag",
            );
            throw err;
          }
        },
        undo: async () => {
          if (createdId) await deleteTag.mutateAsync(createdId);
        },
        redo: async () => {
          if (createdId) await restoreTag.mutateAsync(createdId);
        },
      });
      if (!applied) return;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create tag");
    }
  };

  const saveEdit = async (id: string) => {
    const nextName = editName.trim().replace(/\s+/g, " ");
    if (!nextName) {
      toast.error("Tag name is required");
      return;
    }

    const before = tags.find((tag) => tag.id === id);
    const updates = { name: nextName, type: editType, color: editColor };
    try {
      if (!before) {
        await updateTag.mutateAsync({ id, ...updates });
      } else {
        const applied = await execute({
          id: crypto.randomUUID(),
          label: "Update tag",
          apply: async () => {
            await updateTag.mutateAsync({ id, ...updates });
          },
          undo: async () => {
            await updateTag.mutateAsync({
              id,
              name: before.name,
              type: before.type,
              color: before.color,
            });
          },
          redo: async () => {
            await updateTag.mutateAsync({ id, ...updates });
          },
        });
        if (!applied) throw new Error("Failed to update tag");
      }
      successToast("Tag updated");
      setEditId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tag");
    }
  };

  function handleEditRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    tagId: string,
  ) {
    if (updateTag.isPending) return;
    handleEnterSave(event, () => {
      void saveEdit(tagId);
    });
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      const target = deleteTarget;
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete tag",
        apply: async () => {
          await deleteTag.mutateAsync(target.id);
        },
        undo: async () => {
          await restoreTag.mutateAsync(target.id);
        },
        redo: async () => {
          await deleteTag.mutateAsync(target.id);
        },
      });
      if (!applied) throw new Error("Failed to delete tag");
      successToast("Tag deleted");
      setDeleteTarget(null);
      if (editId === target.id) setEditId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete tag");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-secondary/10 p-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_auto_auto] md:items-end">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New tag"
              className="h-9 w-full rounded border border-border bg-input px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <SimpleSelect
            label="Type"
            value={type}
            onChange={(event) => setType(event.target.value as TagType)}
            options={tagTypeOptions}
          />
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              Color
            </div>
            <ColorPicker
              value={color}
              onChange={setColor}
              label="New tag color"
            />
          </div>
          <Button
            type="button"
            onClick={() => void create()}
            loading={createTag.isPending}
          >
            Create
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
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
            <tr>
              <th
                className="relative px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                style={getHeaderStyle("tag")}
              >
                Tag
                <span
                  {...getResizeHandleProps("tag")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                style={getHeaderStyle("type")}
              >
                Type
                <span
                  {...getResizeHandleProps("type")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                style={getHeaderStyle("color")}
              >
                Color
                <span
                  {...getResizeHandleProps("color")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
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
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td
                  colSpan={4}
                  className="px-2 py-4 text-center text-sm text-muted-foreground"
                >
                  Loading tags...
                </td>
              </tr>
            )}
            {!isLoading && sortedTags.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-2 py-4 text-center text-sm text-muted-foreground"
                >
                  No tags yet.
                </td>
              </tr>
            )}
            {sortedTags.map((tag) => {
              const isEditing = editId === tag.id;
              return (
                <tr
                  key={tag.id}
                  onKeyDown={
                    isEditing
                      ? (event) => handleEditRowKeyDown(event, tag.id)
                      : undefined
                  }
                  className="hover:bg-secondary/20"
                >
                  <td className="px-2 py-1.5 text-sm">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        className="h-8 w-full rounded border border-border bg-input px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    ) : (
                      <TagChip tag={tag} />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-sm">
                    {isEditing ? (
                      <SimpleSelect
                        value={editType}
                        onChange={(event) =>
                          setEditType(event.target.value as TagType)
                        }
                        options={tagTypeOptions}
                        className="h-8 text-xs"
                      />
                    ) : (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                        {tag.type}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-sm">
                    {isEditing ? (
                      <ColorPicker
                        value={editColor}
                        onChange={setEditColor}
                        label={`${tag.name} color`}
                      />
                    ) : (
                      <span
                        className="inline-block h-5 w-5 rounded border border-border"
                        style={{
                          backgroundColor: resolveEntityColor(
                            tag.id,
                            tag.color,
                          ),
                        }}
                        title={tag.color ?? "Automatic color"}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-sm">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void saveEdit(tag.id)}
                          disabled={updateTag.isPending}
                          className="rounded p-1 text-green-400 hover:bg-secondary disabled:opacity-50"
                          title="Save tag"
                        >
                          <Save className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(null)}
                          disabled={updateTag.isPending}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(tag)}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          title="Edit tag"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(tag)}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-red-400"
                          title="Delete tag"
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
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Tag"
        message={
          deleteTarget
            ? `Delete tag "${deleteTarget.name}"? It will be removed from existing transactions.`
            : ""
        }
        isLoading={deleteTag.isPending}
      />
    </div>
  );
}
