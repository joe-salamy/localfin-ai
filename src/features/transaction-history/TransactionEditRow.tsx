import { Check, X } from "lucide-react";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";

interface TransactionEditRowProps {
  saving: boolean;
  onSave(): void;
  onCancel(): void;
}

export function TransactionEditRow({
  saving,
  onSave,
  onCancel,
}: TransactionEditRowProps) {
  return (
    <div className="flex gap-1">
      <button
        onClick={onSave}
        disabled={saving}
        className="p-1 rounded hover:bg-secondary text-green-400"
        title="Save"
      >
        <Check className="h-3.5 w-3.5" />
        <ShortcutHint commandId="transactionHistory.saveEdit" />
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="p-1 rounded hover:bg-secondary text-muted-foreground"
        title="Cancel"
      >
        <X className="h-3.5 w-3.5" />
        <ShortcutHint commandId="transactionHistory.cancelEdit" />
      </button>
    </div>
  );
}
