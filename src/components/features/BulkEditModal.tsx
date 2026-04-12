import { useState } from 'react';
import type { Subcategory } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SimpleSelect } from '@/components/ui/SimpleSelect';

interface BulkEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (subcategoryId: string) => void;
  selectedCount: number;
  subcategories: Subcategory[];
  isLoading?: boolean;
}

export function BulkEditModal({
  isOpen,
  onClose,
  onConfirm,
  selectedCount,
  subcategories,
  isLoading,
}: BulkEditModalProps) {
  const [subcategoryId, setSubcategoryId] = useState('');

  const handleConfirm = () => {
    if (subcategoryId) {
      onConfirm(subcategoryId);
    }
  };

  const handleClose = () => {
    setSubcategoryId('');
    onClose();
  };

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
        options={subcategories.map((s) => ({ value: s.id, label: s.name }))}
        placeholder="Select subcategory..."
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={!subcategoryId}
          loading={isLoading}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
