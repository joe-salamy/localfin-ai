import { useState } from 'react';
import type { Subcategory } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SimpleSelect } from '@/components/ui/SimpleSelect';
import { buildCategoryLookup, formatSubcategoryLabel } from '@/lib/categoryLabels';
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint';
import { useShortcut, useShortcutScope } from '@/features/shortcuts/hooks';
import type { Category } from '@/types';

interface BulkEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (subcategoryId: string) => void;
  selectedCount: number;
  categories: Category[];
  subcategories: Subcategory[];
  isLoading?: boolean;
}

export function BulkEditModal({
  isOpen,
  onClose,
  onConfirm,
  selectedCount,
  categories,
  subcategories,
  isLoading,
}: BulkEditModalProps) {
  const [subcategoryId, setSubcategoryId] = useState('');
  const categoryLookup = buildCategoryLookup(categories);

  const handleConfirm = () => {
    if (subcategoryId) {
      onConfirm(subcategoryId);
    }
  };

  const handleClose = () => {
    setSubcategoryId('');
    onClose();
  };

  useShortcutScope('modal', isOpen);
  useShortcut('modal.confirm', handleConfirm, { enabled: isOpen && Boolean(subcategoryId) && !isLoading });
  useShortcut('modal.cancel', handleClose, { enabled: isOpen && !isLoading });

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title="Bulk Edit"
      size="sm"
    >
      <p className="text-sm text-muted-foreground mb-3">
        Change subcategory for {selectedCount} transaction{selectedCount !== 1 ? 's' : ''}
      </p>
      <SimpleSelect
        value={subcategoryId}
        onChange={(e) => setSubcategoryId(e.target.value)}
        options={subcategories.map((s) => ({
          value: s.id,
          label: formatSubcategoryLabel(s, categoryLookup),
        }))}
        placeholder="Select subcategory..."
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleClose} disabled={isLoading}>
          Cancel
          <ShortcutHint commandId="modal.cancel" />
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={!subcategoryId}
          loading={isLoading}
        >
          Confirm
          <ShortcutHint commandId="modal.confirm" />
        </Button>
      </div>
    </Modal>
  );
}
