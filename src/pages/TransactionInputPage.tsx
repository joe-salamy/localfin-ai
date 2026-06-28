import { Link } from "react-router-dom";
import { toast } from "sonner";
import { MultiTransactionTable } from "@/components/features/MultiTransactionTable";
import { RecentAccountTransactionsTable } from "@/components/features/RecentAccountTransactionsTable";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAccountLinking } from "@/hooks/useAccountLinking";

export function TransactionInputPage() {
  const { connections, isLoading, syncProviderConnections } =
    useAccountLinking();
  const activeConnections = connections.filter(
    (connection) => connection.status === "active",
  );

  async function handleSyncLinkedAccounts() {
    try {
      const result = await syncProviderConnections.mutateAsync({});
      const totals = (result.data ?? []).reduce(
        (sum, sync) => ({
          accounts: sum.accounts + sync.accountsUpserted,
          added: sum.added + sync.transactionsAdded,
          updated: sum.updated + sync.transactionsUpdated,
          removed: sum.removed + sync.transactionsRemoved,
        }),
        { accounts: 0, added: 0, updated: 0, removed: 0 },
      );

      toast.success(
        `Synced ${totals.accounts} account(s), added ${totals.added} transaction(s), updated ${totals.updated}, removed ${totals.removed}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to sync providers",
      );
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Add Transactions</h1>
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">
            Sync linked accounts
          </h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading linked providers...
            </p>
          ) : activeConnections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Link Plaid or Akoya accounts in Setup to sync transactions from
              providers instead of pasting statements.{" "}
              <Link to="/setup" className="text-foreground underline">
                Setup
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Import provider transactions directly into LocalFin without using
              the manual entry table.
            </p>
          )}
        </div>
        {activeConnections.length > 0 && (
          <Button
            type="button"
            size="sm"
            onClick={handleSyncLinkedAccounts}
            loading={syncProviderConnections.isPending}
          >
            Sync linked accounts
          </Button>
        )}
      </Card>
      <RecentAccountTransactionsTable />
      <MultiTransactionTable />
    </div>
  );
}
