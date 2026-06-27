import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { TagChip } from '@/components/features/TagPicker';
import { cn, formatCurrency } from '@/lib/utils';
import type { TagSummary as TagSummaryType } from '@/types';

interface TagSummaryTableProps {
  tags: TagSummaryType[];
}

const headerClass = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider';
const cellClass = 'px-2 py-1.5 text-sm whitespace-nowrap';

export function TagSummaryTable({ tags }: TagSummaryTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full">
        <thead className="bg-secondary/50">
          <tr>
            <th className={cn(headerClass, 'w-8')} />
            <th className={headerClass}>Tag</th>
            <th className={headerClass}>Type</th>
            <th className={cn(headerClass, 'text-right')}>Spend</th>
            <th className={cn(headerClass, 'text-right')}>Income</th>
            <th className={cn(headerClass, 'text-right')}>Net</th>
            <th className={cn(headerClass, 'text-right')}>Count</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tags.length === 0 && (
            <tr>
              <td colSpan={7} className="px-2 py-4 text-center text-sm text-muted-foreground">
                No tag data.
              </td>
            </tr>
          )}
          {tags.map((tag) => {
            const isOpen = expanded.has(tag.tag_id);
            const chipTag = {
              id: tag.tag_id,
              name: tag.tag_name,
              type: tag.tag_type,
              color: tag.tag_color,
            };
            return (
              <TagSummaryRow
                key={tag.tag_id}
                tag={tag}
                chipTag={chipTag}
                isOpen={isOpen}
                onToggle={() => toggle(tag.tag_id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TagSummaryRow({
  tag,
  chipTag,
  isOpen,
  onToggle,
}: {
  tag: TagSummaryType;
  chipTag: { id: string; name: string; type: TagSummaryType['tag_type']; color: string | null };
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-secondary/30" onClick={onToggle}>
        <td className={cellClass}>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className={cellClass}>
          <TagChip tag={chipTag} />
        </td>
        <td className={cellClass}>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
            {tag.tag_type}
          </span>
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums text-expense')}>
          {formatCurrency(tag.expense_total)}
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums text-income')}>
          {formatCurrency(tag.income_total)}
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums', tag.net_total >= 0 ? 'text-income' : 'text-expense')}>
          {formatCurrency(tag.net_total)}
        </td>
        <td className={cn(cellClass, 'text-right font-mono tabular-nums')}>
          {tag.transaction_count}
        </td>
      </tr>
      {isOpen && tag.categories.length > 0 && (
        <tr>
          <td colSpan={7} className="p-0">
            <div className="bg-secondary/20 px-6 py-2">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={headerClass}>Category</th>
                    <th className={cn(headerClass, 'text-right')}>Spend</th>
                    <th className={cn(headerClass, 'text-right')}>Income</th>
                    <th className={cn(headerClass, 'text-right')}>Net</th>
                    <th className={cn(headerClass, 'text-right')}>Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {tag.categories.map((category) => (
                    <tr key={category.category_id ?? 'uncategorized'} className="hover:bg-secondary/20">
                      <td className={cn(cellClass, 'text-xs')}>
                        <EntityLabel
                          id={category.category_id ?? 'uncategorized'}
                          name={category.category_name ?? 'Uncategorized'}
                          color={category.category_color}
                        />
                      </td>
                      <td className={cn(cellClass, 'text-right font-mono tabular-nums text-xs text-expense')}>
                        {formatCurrency(category.expense_total)}
                      </td>
                      <td className={cn(cellClass, 'text-right font-mono tabular-nums text-xs text-income')}>
                        {formatCurrency(category.income_total)}
                      </td>
                      <td className={cn(cellClass, 'text-right font-mono tabular-nums text-xs', category.net_total >= 0 ? 'text-income' : 'text-expense')}>
                        {formatCurrency(category.net_total)}
                      </td>
                      <td className={cn(cellClass, 'text-right font-mono tabular-nums text-xs')}>
                        {category.transaction_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
      {isOpen && tag.categories.length === 0 && (
        <tr>
          <td colSpan={7} className="px-6 py-2 text-xs text-muted-foreground">
            No categories.
          </td>
        </tr>
      )}
    </>
  );
}
