import { useState } from 'react';
import type { AccountSummary as AccountSummaryType, NetWorthSummary } from '@/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { formatCurrency, cn } from '@/lib/utils';
import { DISPLAY_DATE_FORMAT } from '@/config/constants';
import { useAmountGradient } from '@/features/display-settings/hooks';

interface AccountSummaryProps {
  accounts: AccountSummaryType[];
  netWorth: NetWorthSummary;
}

const headerClass = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider';
const cellClass = 'px-2 py-1.5 text-sm whitespace-nowrap';

export function AccountSummaryTable({ accounts, netWorth }: AccountSummaryProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="lf-table-wrap overflow-x-auto">
      <table className="w-full">
        <thead className="bg-secondary/50">
          <tr>
            <th className={cn(headerClass, 'w-8')} />
            <th className={headerClass}>Account</th>
            <th className={headerClass}>Type</th>
            <th className={cn(headerClass, 'text-right')}>Starting</th>
            <th className={cn(headerClass, 'text-right')}>Change</th>
            <th className={cn(headerClass, 'text-right')}>Ending</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounts.map((a) => {
            const isOpen = expanded.has(a.account_id);
            return (
              <AccountRow
                key={a.account_id}
                account={a}
                isOpen={isOpen}
                onToggle={() => toggle(a.account_id)}
              />
            );
          })}
          <tr className="bg-secondary/30 font-semibold">
            <td className={cellClass} />
            <td className={cellClass} colSpan={2}>Net Worth</td>
            <td className={cn(cellClass, 'text-right text-income')}>
              {formatCurrency(netWorth.total_assets)}
              <span className="text-xs text-muted-foreground ml-1">assets</span>
            </td>
            <td className={cn(cellClass, 'text-right text-expense')}>
              {formatCurrency(netWorth.total_liabilities)}
              <span className="text-xs text-muted-foreground ml-1">liab.</span>
            </td>
            <td className={cn(cellClass, 'text-right', netWorth.net_worth >= 0 ? 'text-income' : 'text-expense')}>
              {formatCurrency(netWorth.net_worth)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AccountRow({
  account,
  isOpen,
  onToggle,
}: {
  account: AccountSummaryType;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const getGradientStyle = useAmountGradient(account.transactions.map((transaction) => transaction.amount));

  return (
    <>
      <tr className="hover:bg-secondary/30 cursor-pointer" onClick={onToggle}>
        <td className={cellClass}>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className={cellClass}>
          <EntityLabel id={account.account_id} name={account.account_name} color={account.account_color} />
        </td>
        <td className={cellClass}>
          <span className={cn(
            'inline-block rounded-full px-2 py-0.5 text-[0.66rem] font-bold uppercase tracking-[0.08em]',
            account.account_type === 'asset' ? 'bg-primary/10 text-income' : 'bg-destructive/10 text-expense'
          )}>
            {account.account_type}
          </span>
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums')}>
          {formatCurrency(account.starting_balance)}
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums', account.total_change >= 0 ? 'text-income' : 'text-expense')}>
          {formatCurrency(account.total_change)}
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums')}>
          {formatCurrency(account.ending_balance)}
        </td>
      </tr>
      {isOpen && account.transactions.length > 0 && (
        <tr>
          <td colSpan={6} className="p-0">
            <div className="bg-secondary/20 px-6 py-2">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={headerClass}>Date</th>
                    <th className={headerClass}>Name</th>
                    <th className={cn(headerClass, 'text-right')}>Amount</th>
                    <th className={cn(headerClass, 'text-right')}>Balance</th>
                    <th className={headerClass}>Category</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {account.transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-secondary/20" style={getGradientStyle(t.amount)}>
                      <td className={cn(cellClass, 'text-xs')}>{format(parseISO(t.date), DISPLAY_DATE_FORMAT)}</td>
                      <td className={cn(cellClass, 'text-xs')}>{t.name}</td>
                      <td className={cn(cellClass, 'text-right font-mono tabular-nums text-xs', t.amount >= 0 ? 'text-income' : 'text-expense')}>
                        {formatCurrency(t.amount)}
                      </td>
                      <td className={cn(cellClass, 'text-right font-mono tabular-nums text-xs')}>
                        {formatCurrency(t.running_balance)}
                      </td>
                      <td className={cn(cellClass, 'text-xs text-muted-foreground')}>
                        {t.category_name && t.subcategory_name ? (
                          <span className="inline-flex items-center gap-1">
                            <EntityLabel id={t.category_name} name={t.category_name} color={t.category_color} />
                            <span>&gt;</span>
                            <EntityLabel id={t.subcategory_name} name={t.subcategory_name} color={t.subcategory_color} />
                          </span>
                        ) : (
                          <EntityLabel id={t.subcategory_name} name={t.subcategory_name} color={t.subcategory_color} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
      {isOpen && account.transactions.length === 0 && (
        <tr>
          <td colSpan={6} className="px-6 py-2 text-xs text-muted-foreground">
            No transactions in this period.
          </td>
        </tr>
      )}
    </>
  );
}
