import { useCallback, useRef, useState } from 'react';
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
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint';
import { useShortcutMetadata } from '@/features/shortcuts/hooks';
import { useShortcut, useShortcutScope } from '@/features/shortcuts/hooks';
import type { CommandId } from '@/features/shortcuts/commands';

const ALL_TIME_START_DATE = '0001-01-01';

export function DashboardPage() {
  const today = format(new Date(), DATE_FORMAT);
  const defaultStart = format(subDays(new Date(), DEFAULT_DATE_RANGE_DAYS), DATE_FORMAT);

  const [startInput, setStartInput] = useState(defaultStart);
  const [endInput, setEndInput] = useState(today);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);

  useShortcutScope('dashboard');

  const dashboardStartDate = startDate || ALL_TIME_START_DATE;
  const dashboardEndDate = endDate || today;

  const { accountSummary, netWorth, categorySummary, metrics, netWorthChart, sankeyChart, isLoading } =
    useDashboard(dashboardStartDate, dashboardEndDate);

  const applyDates = useCallback(() => {
    setStartDate(startInput);
    setEndDate(endInput);
  }, [endInput, startInput]);

  const applyDateRangePreset = useCallback((preset: DateRangePreset) => {
    const range = preset.getRange();
    setStartInput(range.startDate);
    setEndInput(range.endDate);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }, []);

  useShortcut('dashboard.applyDateRange', applyDates);
  useShortcut('dashboard.focusStartDate', useCallback(() => startInputRef.current?.focus(), []));
  useShortcut('dashboard.focusEndDate', useCallback(() => endInputRef.current?.focus(), []));

  const applyPreset1 = useCallback(() => dateRangePresets[0] && applyDateRangePreset(dateRangePresets[0]), [applyDateRangePreset]);
  const applyPreset2 = useCallback(() => dateRangePresets[1] && applyDateRangePreset(dateRangePresets[1]), [applyDateRangePreset]);
  const applyPreset3 = useCallback(() => dateRangePresets[2] && applyDateRangePreset(dateRangePresets[2]), [applyDateRangePreset]);
  const applyPreset4 = useCallback(() => dateRangePresets[3] && applyDateRangePreset(dateRangePresets[3]), [applyDateRangePreset]);
  const applyPreset5 = useCallback(() => dateRangePresets[4] && applyDateRangePreset(dateRangePresets[4]), [applyDateRangePreset]);
  const applyPreset6 = useCallback(() => dateRangePresets[5] && applyDateRangePreset(dateRangePresets[5]), [applyDateRangePreset]);
  useShortcut('dashboard.preset1', applyPreset1, { enabled: dateRangePresets.length > 0 });
  useShortcut('dashboard.preset2', applyPreset2, { enabled: dateRangePresets.length > 1 });
  useShortcut('dashboard.preset3', applyPreset3, { enabled: dateRangePresets.length > 2 });
  useShortcut('dashboard.preset4', applyPreset4, { enabled: dateRangePresets.length > 3 });
  useShortcut('dashboard.preset5', applyPreset5, { enabled: dateRangePresets.length > 4 });
  useShortcut('dashboard.preset6', applyPreset6, { enabled: dateRangePresets.length > 5 });

  const applyShortcut = useShortcutMetadata('dashboard.applyDateRange');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Start</label>
            <input
              ref={startInputRef}
              type="date"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              className="h-8 rounded border border-border bg-input px-2 text-sm text-foreground"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">End</label>
            <input
              ref={endInputRef}
              type="date"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              className="h-8 rounded border border-border bg-input px-2 text-sm text-foreground"
            />
          </div>
          <Button
            size="sm"
            onClick={applyDates}
            aria-keyshortcuts={applyShortcut.ariaKeyShortcuts}
            title={`Apply (${applyShortcut.label})`}
          >
            Apply
            <ShortcutHint commandId="dashboard.applyDateRange" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {dateRangePresets.map((preset, index) => {
            const range = preset.getRange();
            const isActive = startDate === range.startDate && endDate === range.endDate;
            const commandId = `dashboard.preset${index + 1}` as CommandId;

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
                {index < 6 && <ShortcutHint commandId={commandId} />}
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
