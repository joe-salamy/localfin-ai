import { useState } from 'react';
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
import { DATE_FORMAT, DEFAULT_DATE_RANGE_DAYS } from '@/config/constants';
import { dateRangePresets, type DateRangePreset } from '@/lib/dateRangePresets';

const ALL_TIME_START_DATE = '0001-01-01';

export function DashboardPage() {
  const today = format(new Date(), DATE_FORMAT);
  const defaultStart = format(subDays(new Date(), DEFAULT_DATE_RANGE_DAYS), DATE_FORMAT);

  const [startInput, setStartInput] = useState(defaultStart);
  const [endInput, setEndInput] = useState(today);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);

  const dashboardStartDate = startDate || ALL_TIME_START_DATE;
  const dashboardEndDate = endDate || today;

  const { accountSummary, netWorth, categorySummary, metrics, netWorthChart, sankeyChart, isLoading } =
    useDashboard(dashboardStartDate, dashboardEndDate);

  const applyDates = () => {
    setStartDate(startInput);
    setEndDate(endInput);
  };

  const applyDateRangePreset = (preset: DateRangePreset) => {
    const range = preset.getRange();
    setStartInput(range.startDate);
    setEndInput(range.endDate);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
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
        <div className="flex flex-wrap gap-2">
          {dateRangePresets.map((preset) => {
            const range = preset.getRange();
            const isActive = startDate === range.startDate && endDate === range.endDate;

            return (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={isActive ? 'primary' : 'secondary'}
                onClick={() => applyDateRangePreset(preset)}
                className="h-7 px-2 text-xs"
              >
                {preset.label}
              </Button>
            );
          })}
        </div>
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
