import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import type { CreateTagData, Tag, TagType } from "@/types";
import { Button } from "@/components/ui/Button";
import { SimpleSelect } from "@/components/ui/SimpleSelect";
import { cn } from "@/lib/utils";
import { resolveEntityColor } from "@/lib/colors";

const TAG_TYPES: TagType[] = [
  "custom",
  "trip",
  "event",
  "person",
  "reimbursable",
  "tax",
];

interface TagPickerProps {
  value: string[];
  onChange: (tagIds: string[]) => void;
  tags: Tag[];
  onCreateTag: (data: CreateTagData) => Promise<Tag>;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function tagTypeLabel(type: TagType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function TagChip({
  tag,
  onRemove,
  className,
}: {
  tag: Pick<Tag, "id" | "name" | "type" | "color">;
  onRemove?: () => void;
  className?: string;
}) {
  const color = resolveEntityColor(tag.id, tag.color);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-secondary/70 px-2 py-0.5 text-xs text-foreground",
        className,
      )}
      title={`${tag.name} (${tag.type})`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Remove ${tag.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export const TagPicker = forwardRef<HTMLButtonElement, TagPickerProps>(
  (
    {
      value,
      onChange,
      tags,
      onCreateTag,
      className,
      disabled,
      placeholder = "Select tags",
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newType, setNewType] = useState<TagType>("custom");
    const [creating, setCreating] = useState(false);

    const valueRef = useRef(value);

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    const selectedIds = useMemo(() => new Set(value), [value]);
    const activeTags = useMemo(
      () =>
        [...tags]
          .filter((tag) => !tag.deleted_at)
          .sort(
            (a, b) =>
              a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
          ),
      [tags],
    );
    const selectedTags = activeTags.filter((tag) => selectedIds.has(tag.id));

    const toggleTag = (tagId: string) => {
      onChange(
        selectedIds.has(tagId)
          ? value.filter((id) => id !== tagId)
          : [...value, tagId],
      );
    };

    const handleCreate = async () => {
      const name = normalizeTagName(newName);
      if (!name || creating || disabled) return;

      const existing = activeTags.find(
        (tag) =>
          tag.type === newType &&
          normalizeTagName(tag.name).toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        const latestValue = valueRef.current;
        if (!latestValue.includes(existing.id))
          onChange([...latestValue, existing.id]);
        setNewName("");
        return;
      }

      setCreating(true);
      try {
        const tag = await onCreateTag({ name, type: newType });
        const latestValue = valueRef.current;
        if (!latestValue.includes(tag.id)) onChange([...latestValue, tag.id]);
        setNewName("");
      } catch {
        // Parent wrappers own toast/error messaging for failed tag creation.
      } finally {
        setCreating(false);
      }
    };

    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            className={cn(
              "flex min-h-8 w-full items-center justify-between gap-2 rounded border border-border bg-input px-2 py-1 text-left text-xs text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          >
            <span className="flex min-w-0 flex-1 flex-wrap gap-1">
              {selectedTags.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : (
                selectedTags.map((tag) => <TagChip key={tag.id} tag={tag} />)
              )}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 w-72 rounded-md border border-border bg-card p-2 shadow-lg"
          >
            <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
              {activeTags.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No tags yet.
                </p>
              )}
              {activeTags.map((tag) => {
                const selected = selectedIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: resolveEntityColor(tag.id, tag.color),
                      }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {tag.type}
                    </span>
                    {selected && (
                      <Check className="h-3.5 w-3.5 text-green-400" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 border-t border-border pt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreate();
                    }
                  }}
                  placeholder="New tag name"
                  disabled={disabled || creating}
                  className="h-8 min-w-0 flex-1 rounded border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCreate()}
                  loading={creating}
                  disabled={disabled}
                  className="h-8 px-2"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <SimpleSelect
                value={newType}
                onChange={(event) => setNewType(event.target.value as TagType)}
                options={TAG_TYPES.map((type) => ({
                  value: type,
                  label: tagTypeLabel(type),
                }))}
                disabled={disabled || creating}
                className="mt-2 h-8 text-xs"
                aria-label="New tag type"
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  },
);

TagPicker.displayName = "TagPicker";
