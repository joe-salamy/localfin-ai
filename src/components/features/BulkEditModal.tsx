import { useState } from 'react';
import type { CreateTagData, Subcategory, Tag, TransactionKind } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SimpleSelect } from '@/components/ui/SimpleSelect';
import { buildCategoryLookup, formatSubcategoryLabel } from '@/lib/categoryLabels';
import { TagPicker } from '@/components/features/TagPicker';
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint';
import { useShortcut, useShortcutScope } from '@/features/shortcuts/hooks';
import type { Category } from '@/types';

interface BulkEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (updates: { kind?: TransactionKind; subcategory_id?: string | null; add_tag_ids?: string[]; remove_tag_ids?: string[] }) => void;
  selectedCount: number;
  categories: Category[];
  subcategories: Subcategory[];
  tags: Tag[];
  onCreateTag: (data: CreateTagData) => Promise<Tag>;
  isLoading?: boolean;
}

export function BulkEditModal({
  isOpen,
  onClose,
  onConfirm,
  selectedCount,
  categories,
  subcategories,
  tags,
  onCreateTag,
  isLoading,
}: BulkEditModalProps) {
  const [subcategoryId, setSubcategoryId] = useState('');
  const [kind, setKind] = useState<'unchanged' | TransactionKind>('unchanged');
  const [addTagIds, setAddTagIds] = useState<string[]>([]);
  const [removeTagIds, setRemoveTagIds] = useState<string[]>([]);
  const categoryLookup = buildCategoryLookup(categories);
  const kindHasSubcategory = kind !== 'transfer' && kind !== 'adjustment';

  const resetState = () => {
    setSubcategoryId('');
    setKind('unchanged');
    setAddTagIds([]);
    setRemoveTagIds([]);
  };

  const overlappingTagIds = addTagIds.filter((tagId) => removeTagIds.includes(tagId));
  const hasChanges = kind !== 'unchanged' || Boolean(subcategoryId) || addTagIds.length > 0 || removeTagIds.length > 0;
  const canConfirm = hasChanges && overlappingTagIds.length === 0 && !isLoading;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      ...(kind !== 'unchanged' ? { kind } : {}),
      ...(subcategoryId && kindHasSubcategory ? { subcategory_id: subcategoryId } : {}),
      ...(addTagIds.length > 0 ? { add_tag_ids: addTagIds } : {}),
      ...(removeTagIds.length > 0 ? { remove_tag_ids: removeTagIds } : {}),
    });
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  useShortcutScope('modal', isOpen);
  useShortcut('modal.confirm', handleConfirm, { enabled: isOpen && canConfirm });
  useShortcut('modal.cancel', handleClose, { enabled: isOpen && !isLoading });

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title="Bulk Edit"
      size="sm"
    >
      <p className="text-sm text-muted-foreground mb-3">
        Change type, subcategory, or tags for {selectedCount} transaction{selectedCount !== 1 ? 's' : ''}
      </p>
      <SimpleSelect
        value={kind}
        onChange={(e) => {
          const nextKind = e.target.value as typeof kind;
          setKind(nextKind);
          if (nextKind === 'transfer' || nextKind === 'adjustment') setSubcategoryId('');
        }}
        options={[
          { value: 'unchanged', label: 'Leave Type' },
          { value: 'income', label: 'Income' },
          { value: 'expense', label: 'Expense' },
          { value: 'transfer', label: 'Transfer' },
          { value: 'adjustment', label: 'Adjustment' },
        ]}
      />
      <div className="mt-2" />
      <SimpleSelect
        value={subcategoryId}
        onChange={(e) => setSubcategoryId(e.target.value)}
        options={subcategories.map((s) => ({
          value: s.id,
          label: formatSubcategoryLabel(s, categoryLookup),
        }))}
        placeholder="Select subcategory..."
        disabled={!kindHasSubcategory}
      />
      <div className="mt-3 space-y-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Add tags</label>
          <TagPicker
            value={addTagIds}
            onChange={setAddTagIds}
            tags={tags}
            onCreateTag={onCreateTag}
            disabled={isLoading}
            placeholder="Tags to add"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Remove tags</label>
          <TagPicker
            value={removeTagIds}
            onChange={setRemoveTagIds}
            tags={tags}
            onCreateTag={onCreateTag}
            disabled={isLoading}
            placeholder="Tags to remove"
          />
        </div>
        {overlappingTagIds.length > 0 && (
          <p className="text-xs text-destructive">A tag cannot be both added and removed.</p>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleClose} disabled={isLoading}>
          Cancel
          <ShortcutHint commandId="modal.cancel" />
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={!canConfirm}
          loading={isLoading}
        >
          Confirm
          <ShortcutHint commandId="modal.confirm" />
        </Button>
      </div>
    </Modal>
  );
}
