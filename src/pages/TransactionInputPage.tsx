import { MultiTransactionTable } from '@/components/features/MultiTransactionTable';
import { RecentAccountTransactionsTable } from '@/components/features/RecentAccountTransactionsTable';

export function TransactionInputPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Add Transactions</h1>
      <RecentAccountTransactionsTable />
      <MultiTransactionTable />
    </div>
  );
}
