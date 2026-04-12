import { useState, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { useDashboard } from '@/hooks/useDashboard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AccountSummaryTable } from '@/components/features/AccountSummary';
import { CategorySummaryTable } from '@/components/features/CategorySummary';
import { NetWorthChart } from '@/components/features/NetWorthChart';
import { SankeyDiagram } from '@/components/features/SankeyDiagram';
import { formatCurrency, cn } from '@/lib/utils';
import { DEFAULT_DATE_RANGE_DAYS } from '@/config/constants';
import type { NetWorthSummary } from '@/types';

const DATE_FMT = 'yyyy-MM-dd';

export function DashboardPage() {
  const today = format(new Date(), DATE_FMT);
  const defaultStart = format(subDays(new Date(), DEFAULT_DATE_RANGE_DAYS), DATE_FMT);

  const [startInput, setStartInput] = useState(defaultStart);
  const [endInput, setEndInput] = useState(today);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);

  const { accountSummary, categorySummary, metrics, netWorthChart, sankeyChart, isLoading } =
    useDashboard(startDate, endDate);

  const applyDates = () => {
    setStartDate(startInput);
    setEndDate(endInput);
  };

  const netWorth = useMemo<NetWorthSummary>(() => {
    let total_assets = 0;
    let total_liabilities = 0;
    for (const a of accountSummary) {
      if (a.account_type === 'asset') total_assets += a.ending_balance;
      else total_liabilities += a.ending_balance;
    }
    return { total_assets, total_liabilities, net_worth: total_assets - total_liabilities };
  }, [accountSummary]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Start</label>
          <input
            type="date"
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
            className="h-8 rounded border border-border bg-input px-2 text-sm text-foreground"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">End</label>
          <input
            type="date"
            value={endInput}
            onChange={(e) => setEndInput(e.target.value)}
            className="h-8 rounded border border-border bg-input px-2 text-sm text-foreground"
          />
        </div>
        <Button size="sm" onClick={applyDates}>Apply</Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <>
          {/* Metrics cards */}
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Total Income"
              value={metrics?.totalIncome ?? 0}
              icon={<TrendingUp className="h-4 w-4 text-income" />}
              colorClass="text-income"
            />
            <MetricCard
              label="Total Expenses"
              value={metrics?.totalExpenses ?? 0}
              icon={<TrendingDown className="h-4 w-4 text-expense" />}
              colorClass="text-expense"
            />
            <MetricCard
              label="Net Change"
              value={metrics?.netChange ?? 0}
              icon={<Wallet className="h-4 w-4" />}
              colorClass={(metrics?.netChange ?? 0) >= 0 ? 'text-income' : 'text-expense'}
            />
          </div>

          {/* Account Summary */}
          <Card>
            <CardHeader className="mb-2">
              <CardTitle>Account Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <AccountSummaryTable accounts={accountSummary} netWorth={netWorth} />
            </CardContent>
          </Card>

          {/* Category Summary */}
          <Card>
            <CardHeader className="mb-2">
              <CardTitle>Category Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <CategorySummaryTable categories={categorySummary} />
            </CardContent>
          </Card>

          {/* Net Worth Chart */}
          <Card>
            <CardHeader className="mb-2">
              <CardTitle>Net Worth Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <NetWorthChart data={netWorthChart} />
            </CardContent>
          </Card>

          {/* Sankey Diagram */}
          <Card>
            <CardHeader className="mb-2">
              <CardTitle>Money Flow</CardTitle>
            </CardHeader>
            <CardContent>
              {sankeyChart ? (
                <SankeyDiagram data={sankeyChart} />
              ) : (
                <p className="text-sm text-muted-foreground py-4">No flow data available.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  colorClass,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p className={cn('text-lg font-semibold font-mono tabular-nums mt-1', colorClass)}>
        {formatCurrency(value)}
      </p>
    </Card>
  );
}
