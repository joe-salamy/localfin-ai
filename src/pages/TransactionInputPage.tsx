import { MultiTransactionTable } from '@/components/features/MultiTransactionTable';

export function TransactionInputPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Add Transactions</h1>
      <MultiTransactionTable />
    </div>
  );
}
