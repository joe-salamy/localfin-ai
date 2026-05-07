import { format, parseISO } from 'date-fns';
import { WalletCards } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { DISPLAY_DATE_FORMAT } from '@/config/constants';
import { useRecentActivity } from '@/hooks/useTransactions';
import { formatCurrency } from '@/lib/utils';

export function RecentAccountTransactionsTable() {
  const { recentActivity, isLoading } = useRecentActivity();

  return (
    <Card className="p-3">
      <CardHeader className="mb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <WalletCards className="h-4 w-4" />
          Latest Transactions by Account
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-card text-left text-muted-foreground">
                <th className="px-2 py-1.5">Account</th>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Latest Transaction</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
                <th className="px-2 py-1.5 text-right">Current Balance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                    Loading account balances...
                  </td>
                </tr>
              )}
              {!isLoading && recentActivity.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                    No active accounts found.
                  </td>
                </tr>
              )}
              {!isLoading && recentActivity.map((activity) => (
                <tr
                  key={activity.account_id}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-2 py-1.5 font-medium text-foreground">
                    {activity.account_name}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {activity.last_transaction_date
                      ? format(parseISO(activity.last_transaction_date), DISPLAY_DATE_FORMAT)
                      : '-'}
                  </td>
                  <td className="px-2 py-1.5 text-foreground">
                    {activity.last_transaction_name ?? '-'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {activity.last_transaction_amount == null
                      ? '-'
                      : (
                        <span className={activity.last_transaction_amount >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {formatCurrency(activity.last_transaction_amount)}
                        </span>
                      )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-foreground">
                    {formatCurrency(activity.current_balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
