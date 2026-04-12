import { useState, useCallback, useMemo } from 'react';
import type { ClipboardEvent, ChangeEvent } from 'react';
import { format, parse } from 'date-fns';
import { X, AlertTriangle, Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useAccounts } from '@/hooks/useAccounts';
import { useCategories } from '@/hooks/useCategories';
import { useTransactions } from '@/hooks/useTransactions';
import { formatDateInput, cn } from '@/lib/utils';
import type { Category, Subcategory, CreateTransactionData } from '@/types';

// ── Row type ──────────────────────────────────────────────────────────

interface TransactionRow {
  id: string;
  date: string;
  name: string;
  amount: string;
  account_id: string;
  subcategory_id: string;
  comment: string;
  isDuplicate: boolean;
  transferMatch: unknown | null;
}

function emptyRow(): TransactionRow {
  return {
    id: crypto.randomUUID(),
    date: '',
    name: '',
    amount: '',
    account_id: '',
    subcategory_id: '',
    comment: '',
    isDuplicate: false,
    transferMatch: null,
  };
}

function initialRows(count = 5): TransactionRow[] {
  return Array.from({ length: count }, () => emptyRow());
}

// ── Helpers ───────────────────────────────────────────────────────────

function isRowFilled(row: TransactionRow) {
  return row.date || row.name || row.amount || row.account_id;
}

function isRowValid(row: TransactionRow) {
  return row.date && row.name && row.amount && row.account_id;
}

function displayAmountToNumber(val: string): number {
  const cleaned = val.replace(/[$,\s]/g, '');
  return parseFloat(cleaned) || 0;
}

function formatAmountDisplay(val: string): string {
  const num = displayAmountToNumber(val);
  if (!num && val === '') return '';
  // Keep the raw number so user can edit; just normalise decimals
  const negative = num < 0;
  const abs = Math.abs(num).toFixed(2);
  return negative ? `-${abs}` : abs;
}

function toApiDate(displayDate: string): string {
  // MM/DD/YYYY -> YYYY-MM-DD
  const parsed = parse(displayDate, 'MM/dd/yyyy', new Date());
  return format(parsed, 'yyyy-MM-dd');
}

// ── Grouped subcategory select ────────────────────────────────────────

interface GroupedSelectProps {
  value: string;
  onChange: (value: string) => void;
  categories: Category[];
  subcategories: Subcategory[];
  filterType: 'income' | 'expense' | null;
  className?: string;
}

function GroupedSubcategorySelect({
  value,
  onChange,
  categories,
  subcategories,
  filterType,
  className,
}: GroupedSelectProps) {
  const filtered = useMemo(() => {
    const relevantCategories = filterType
      ? categories.filter((c) => c.type === filterType)
      : categories;

    return relevantCategories
      .map((cat) => ({
        category: cat,
        subs: subcategories.filter((s) => s.category_id === cat.id),
      }))
      .filter((g) => g.subs.length > 0);
  }, [categories, subcategories, filterType]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-7 w-full rounded border border-border bg-input px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <option value="">--</option>
      {filtered.map((group) => (
        <optgroup key={group.category.id} label={group.category.name}>
          {group.subs.map((sub) => (
            <option key={sub.id} value={sub.id}>
              {sub.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function MultiTransactionTable() {
  const { accounts } = useAccounts();
  const { categories, subcategories } = useCategories();
  const { bulkCreateTransactions, checkDuplicates } = useTransactions();

  const [rows, setRows] = useState<TransactionRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [duplicatesChecked, setDuplicatesChecked] = useState(false);

  // ── Row manipulation ──────────────────────────────────────────────

  const updateRow = useCallback(
    (id: string, field: keyof TransactionRow, value: string | boolean) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, [field]: value, isDuplicate: false } : r,
        ),
      );
      setDuplicatesChecked(false);
    },
    [],
  );

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRow()]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      if (prev.length <= 1) return [emptyRow()];
      return prev.filter((r) => r.id !== id);
    });
    setDuplicatesChecked(false);
  }, []);

  const clearAll = useCallback(() => {
    setRows(initialRows());
    setDuplicatesChecked(false);
  }, []);

  // ── Paste handling ────────────────────────────────────────────────

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>, rowIndex: number) => {
      const text = e.clipboardData.getData('text/plain');
      if (!text.includes('\t') && !text.includes('\n')) return;

      e.preventDefault();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      setRows((prev) => {
        const next = [...prev];
        for (let i = 0; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          const targetIdx = rowIndex + i;
          if (targetIdx >= next.length) {
            next.push(emptyRow());
          }
          const row = { ...next[targetIdx] };
          if (cols[0]) row.date = formatDateInput(cols[0]);
          if (cols[1]) row.name = cols[1];
          if (cols[2]) row.amount = cols[2].replace(/[$,\s]/g, '');
          if (cols[3]) {
            // Try to match account name
            const match = accounts.find(
              (a) => a.name.toLowerCase() === cols[3].trim().toLowerCase(),
            );
            if (match) row.account_id = match.id;
          }
          next[targetIdx] = row;
        }
        return next;
      });
      setDuplicatesChecked(false);
    },
    [accounts],
  );

  // ── Submit ────────────────────────────────────────────────────────

  const filledRows = useMemo(() => rows.filter(isRowFilled), [rows]);

  const handleSave = useCallback(async () => {
    // Validate
    const invalid = filledRows.filter((r) => !isRowValid(r));
    if (invalid.length > 0) {
      toast.error(
        'Each row needs at least a date, name, amount, and account.',
      );
      return;
    }
    if (filledRows.length === 0) {
      toast.error('No transactions to save.');
      return;
    }

    setSaving(true);

    try {
      // Check duplicates if not already checked
      if (!duplicatesChecked) {
        const dupPayload = filledRows.map((r) => ({
          date: toApiDate(r.date),
          name: r.name,
          amount: displayAmountToNumber(r.amount),
          account_id: r.account_id,
        }));

        const dupResult = await checkDuplicates.mutateAsync(dupPayload);
        const dupData = dupResult.data ?? [];
        const hasDuplicates = dupData.some((d) => d.isDuplicate);

        if (hasDuplicates) {
          // Mark duplicate rows
          setRows((prev) => {
            const filledIds = filledRows.map((r) => r.id);
            let filledIdx = 0;
            return prev.map((r) => {
              if (filledIds.includes(r.id)) {
                const isDup = dupData[filledIdx]?.isDuplicate ?? false;
                filledIdx++;
                return { ...r, isDuplicate: isDup };
              }
              return r;
            });
          });
          setDuplicatesChecked(true);
          setSaving(false);
          toast.warning(
            'Some transactions may be duplicates. Remove them or click Save All again to confirm.',
          );
          return;
        }
      }

      // Build payload
      const payload: CreateTransactionData[] = filledRows.map((r) => ({
        account_id: r.account_id,
        date: toApiDate(r.date),
        name: r.name,
        amount: displayAmountToNumber(r.amount),
        subcategory_id: r.subcategory_id || null,
        comment: r.comment || null,
      }));

      await bulkCreateTransactions.mutateAsync(payload);
      toast.success(`${payload.length} transaction(s) saved.`);
      setRows(initialRows());
      setDuplicatesChecked(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save transactions.',
      );
    } finally {
      setSaving(false);
    }
  }, [filledRows, duplicatesChecked, checkDuplicates, bulkCreateTransactions]);

  // ── Subcategory filter type ───────────────────────────────────────

  const getSubcategoryFilter = (
    amountStr: string,
  ): 'income' | 'expense' | null => {
    const num = displayAmountToNumber(amountStr);
    if (num > 0) return 'income';
    if (num < 0) return 'expense';
    return null;
  };

  // ── Render ────────────────────────────────────────────────────────

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: a.name })),
    [accounts],
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={addRow}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add Row
        </Button>
        <Button size="sm" variant="ghost" onClick={clearAll}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Clear All
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {filledRows.length} row(s) to save
        </span>
        <Button size="sm" onClick={handleSave} loading={saving}>
          <Save className="mr-1 h-3.5 w-3.5" />
          Save All
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-card text-left text-muted-foreground">
              <th className="w-8 px-1 py-1.5" />
              <th className="px-1 py-1.5">Date</th>
              <th className="px-1 py-1.5">Name</th>
              <th className="px-1 py-1.5">Amount</th>
              <th className="px-1 py-1.5">Account</th>
              <th className="px-1 py-1.5">Subcategory</th>
              <th className="px-1 py-1.5">Comment</th>
              <th className="w-8 px-1 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                className={cn(
                  'border-b border-border last:border-b-0',
                  row.isDuplicate && 'bg-yellow-500/10',
                )}
              >
                {/* Duplicate indicator */}
                <td className="px-1 py-0.5 text-center">
                  {row.isDuplicate && (
                    <AlertTriangle className="inline h-3.5 w-3.5 text-yellow-500" />
                  )}
                </td>

                {/* Date */}
                <td className="px-1 py-0.5">
                  <input
                    type="text"
                    placeholder="MM/DD/YYYY"
                    value={row.date}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRow(row.id, 'date', formatDateInput(e.target.value))
                    }
                    onPaste={(e) => handlePaste(e, idx)}
                    className="h-7 w-28 rounded border border-border bg-input px-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                {/* Name */}
                <td className="px-1 py-0.5">
                  <input
                    type="text"
                    placeholder="Description"
                    value={row.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRow(row.id, 'name', e.target.value)
                    }
                    onPaste={(e) => handlePaste(e, idx)}
                    className="h-7 w-44 rounded border border-border bg-input px-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                {/* Amount */}
                <td className="px-1 py-0.5">
                  <input
                    type="text"
                    placeholder="0.00"
                    value={row.amount}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRow(row.id, 'amount', e.target.value)
                    }
                    onBlur={() =>
                      updateRow(
                        row.id,
                        'amount',
                        formatAmountDisplay(row.amount),
                      )
                    }
                    onPaste={(e) => handlePaste(e, idx)}
                    className="h-7 w-24 rounded border border-border bg-input px-1.5 text-right text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                {/* Account */}
                <td className="px-1 py-0.5">
                  <select
                    value={row.account_id}
                    onChange={(e) =>
                      updateRow(row.id, 'account_id', e.target.value)
                    }
                    className="h-7 w-32 rounded border border-border bg-input px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">--</option>
                    {accountOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>

                {/* Subcategory (grouped) */}
                <td className="px-1 py-0.5">
                  <GroupedSubcategorySelect
                    value={row.subcategory_id}
                    onChange={(val) =>
                      updateRow(row.id, 'subcategory_id', val)
                    }
                    categories={categories}
                    subcategories={subcategories}
                    filterType={getSubcategoryFilter(row.amount)}
                    className="w-36"
                  />
                </td>

                {/* Comment */}
                <td className="px-1 py-0.5">
                  <input
                    type="text"
                    placeholder="Note"
                    value={row.comment}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRow(row.id, 'comment', e.target.value)
                    }
                    className="h-7 w-32 rounded border border-border bg-input px-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </td>

                {/* Remove */}
                <td className="px-1 py-0.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label="Remove row"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: Paste tab-delimited data (date, name, amount) from a spreadsheet
        into any field to populate multiple rows.
      </p>
    </div>
  );
}
