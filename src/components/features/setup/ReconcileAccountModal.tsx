import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { AccountWithBalance } from "@shared/contracts";
import { formatCurrency, todayIsoDate } from "@/components/features/setup/setupShared";

export function ReconcileAccountModal({
  account,
  onClose,
  onSubmit,
  isLoading,
}: {
  account: AccountWithBalance;
  onClose: () => void;
  onSubmit: (data: { date: string; target_balance: number }) => Promise<void>;
  isLoading: boolean;
}) {
  const [targetBalance, setTargetBalance] = useState(() =>
    account.current_balance.toFixed(2),
  );
  const [date, setDate] = useState(() => todayIsoDate());

  const targetValue = targetBalance.trim() ? Number(targetBalance) : NaN;
  const delta =
    account && Number.isFinite(targetValue)
      ? Math.round((targetValue - account.current_balance) * 100) / 100
      : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(targetValue)) {
      toast.error("Enter a valid target value");
      return;
    }
    await onSubmit({ date, target_balance: targetValue });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Update Current Value"
      description={account.name}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Current balance</span>
            <span className="font-mono">
              {formatCurrency(account.current_balance)}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span className="text-muted-foreground">Adjustment</span>
            <span
              className={`font-mono ${delta == null || delta >= 0 ? "text-green-400" : "text-red-400"}`}
            >
              {delta == null ? "-" : formatCurrency(delta)}
            </span>
          </div>
        </div>
        <Input
          label="Target value"
          type="number"
          step="0.01"
          value={targetBalance}
          onChange={(event) => setTargetBalance(event.target.value)}
          required
        />
        <Input
          label="As of date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isLoading}>
            Save Adjustment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
