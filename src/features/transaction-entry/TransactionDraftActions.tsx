import { Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";

interface TransactionDraftActionsProps {
  filledRowCount: number;
  categorizing: boolean;
  saving: boolean;
  onAddRow(): void;
  onCategorize(): void;
  onClear(): void;
  onSave(): void;
}

export function TransactionDraftActions({
  filledRowCount,
  categorizing,
  saving,
  onAddRow,
  onCategorize,
  onClear,
  onSave,
}: TransactionDraftActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onAddRow}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add Row
        <ShortcutHint commandId="transactionInput.addRow" />
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={onCategorize}
        loading={categorizing}
      >
        <Sparkles className="mr-1 h-3.5 w-3.5" />
        AI Categorize
        <ShortcutHint commandId="transactionInput.aiCategorize" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        Clear All
        <ShortcutHint commandId="transactionInput.clearAll" />
      </Button>
      <div className="flex-1" />
      <span className="text-xs text-muted-foreground">
        {filledRowCount} row(s) to save
      </span>
      <Button size="sm" onClick={onSave} loading={saving}>
        <Save className="mr-1 h-3.5 w-3.5" />
        Save All
        <ShortcutHint commandId="transactionInput.saveAll" />
      </Button>
    </div>
  );
}
