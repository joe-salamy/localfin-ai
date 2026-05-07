import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint';
import { useShortcut, useShortcutScope } from '@/features/shortcuts/hooks';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  isLoading?: boolean;
}

export function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  isLoading,
}: ConfirmDeleteModalProps) {
  useShortcutScope('modal', isOpen);
  useShortcut('modal.confirm', onConfirm, { enabled: isOpen && !isLoading });
  useShortcut('modal.cancel', onClose, { enabled: isOpen && !isLoading });

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()} title={title} size="sm">
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
          Cancel
          <ShortcutHint commandId="modal.cancel" />
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onConfirm}
          loading={isLoading}
        >
          Delete
          <ShortcutHint commandId="modal.confirm" />
        </Button>
      </div>
    </Modal>
  );
}
