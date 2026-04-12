import { useState } from 'react';
import type { CategorySummary as CategorySummaryType } from '@/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';

interface CategorySummaryProps {
  categories: CategorySummaryType[];
}

const headerClass = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider';
const cellClass = 'px-2 py-1.5 text-sm whitespace-nowrap';

export function CategorySummaryTable({ categories }: CategorySummaryProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="overflow-x-auto border border-border rounded-md">
      <table className="w-full">
        <thead className="bg-secondary/50">
          <tr>
            <th className={cn(headerClass, 'w-8')} />
            <th className={headerClass}>Category</th>
            <th className={headerClass}>Type</th>
            <th className={cn(headerClass, 'text-right')}>Total</th>
            <th className={cn(headerClass, 'text-right')}>Goal</th>
            <th className={cn(headerClass, 'text-right')}>Difference</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {categories.map((c) => {
            const isOpen = expanded.has(c.category_id);
            return (
              <CategoryRow
                key={c.category_id}
                category={c}
                isOpen={isOpen}
                onToggle={() => toggle(c.category_id)}
              />
            );
          })}
          {categories.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-4 text-center text-sm text-muted-foreground">
                No category data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DifferenceCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  // Positive difference = under budget (good), negative = over budget (bad)
  const color = value >= 0 ? 'text-green-400' : 'text-red-400';
  return <span className={cn('font-mono tabular-nums', color)}>{formatCurrency(value)}</span>;
}

function CategoryRow({
  category,
  isOpen,
  onToggle,
}: {
  category: CategorySummaryType;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-secondary/30 cursor-pointer" onClick={onToggle}>
        <td className={cellClass}>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className={cellClass}>{category.category_name}</td>
        <td className={cellClass}>
          <span className={cn(
            'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
            category.category_type === 'income' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
          )}>
            {category.category_type}
          </span>
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums')}>
          {formatCurrency(category.total)}
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums text-muted-foreground')}>
          {category.goal != null ? formatCurrency(category.goal) : '-'}
        </td>
        <td className={cn(cellClass, 'text-right')}>
          <DifferenceCell value={category.difference} />
        </td>
      </tr>
      {isOpen && category.subcategories.length > 0 && (
        <tr>
          <td colSpan={6} className="p-0">
            <div className="bg-secondary/20 px-6 py-2">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={headerClass}>Subcategory</th>
                    <th className={cn(headerClass, 'text-right')}>Total</th>
                    <th className={cn(headerClass, 'text-right')}>Goal</th>
                    <th className={cn(headerClass, 'text-right')}>Difference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {category.subcategories.map((s) => (
                    <tr key={s.subcategory_id} className="hover:bg-secondary/20">
                      <td className={cn(cellClass, 'text-xs')}>{s.subcategory_name}</td>
                      <td className={cn(cellClass, 'text-right font-mono tabular-nums text-xs')}>
                        {formatCurrency(s.total)}
                      </td>
                      <td className={cn(cellClass, 'text-right font-mono tabular-nums text-xs text-muted-foreground')}>
                        {s.goal != null ? formatCurrency(s.goal) : '-'}
                      </td>
                      <td className={cn(cellClass, 'text-right text-xs')}>
                        <DifferenceCell value={s.difference} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
      {isOpen && category.subcategories.length === 0 && (
        <tr>
          <td colSpan={6} className="px-6 py-2 text-xs text-muted-foreground">
            No subcategories.
          </td>
        </tr>
      )}
    </>
  );
}
