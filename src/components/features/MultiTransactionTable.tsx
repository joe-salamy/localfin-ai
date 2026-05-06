import { useState, useCallback, useMemo } from 'react';
import type { ClipboardEvent, ChangeEvent } from 'react';
import { format, parse } from 'date-fns';
import { X, AlertTriangle, Plus, Trash2, Save, Sparkles, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAccounts } from '@/hooks/useAccounts';
import { useAI } from '@/hooks/useAI';
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
  categorizationSource: 'lookup' | 'ai' | 'none' | 'manual';
  aiConfidence: number | null;
  aiSuggestedSubcategoryId: string | null;
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
    categorizationSource: 'manual',
    aiConfidence: null,
    aiSuggestedSubcategoryId: null,
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
  const { categorize, parseStatement } = useAI();

  const [rows, setRows] = useState<TransactionRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [duplicatesChecked, setDuplicatesChecked] = useState(false);
  const [statementText, setStatementText] = useState('');
  const [statementAccountId, setStatementAccountId] = useState('');
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [parseSummary, setParseSummary] = useState<string | null>(null);

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

  const handleSubcategoryChange = useCallback(
    (row: TransactionRow, value: string) => {
      updateRow(row.id, 'subcategory_id', value);
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
              ...r,
              subcategory_id: value,
              categorizationSource: row.categorizationSource === 'ai' ? 'manual' : r.categorizationSource,
            }
            : r,
        ),
      );
    },
    [updateRow],
  );

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

  const handleAICategorize = useCallback(async () => {
    const eligibleRows = filledRows.filter((r) => r.name && r.amount && r.account_id);
    if (eligibleRows.length === 0) {
      toast.error('Rows need a name, amount, and account before AI categorization.');
      return;
    }

    const conversationId = crypto.randomUUID();
    setLastRunId(conversationId);

    try {
      const result = await categorize.mutateAsync({
        conversationId,
        transactions: eligibleRows.map((row) => ({
          name: row.name,
          account_id: row.account_id,
          account_name: accounts.find((account) => account.id === row.account_id)?.name ?? 'Unknown',
          amount: displayAmountToNumber(row.amount),
        })),
      });
      const data = result.data ?? [];
      setRows((prev) => {
        const byId = new Map(eligibleRows.map((row, index) => [row.id, data[index]]));
        return prev.map((row) => {
          const cat = byId.get(row.id);
          if (!cat) return row;
          return {
            ...row,
            subcategory_id: cat.subcategory_id ?? row.subcategory_id,
            categorizationSource: cat.source,
            aiConfidence: cat.confidence,
            aiSuggestedSubcategoryId: cat.source === 'ai' ? cat.subcategory_id : null,
          };
        });
      });
      toast.success(`Categorized ${data.length} row(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI categorization failed.');
    }
  }, [accounts, categorize, filledRows]);

  const handleParseStatement = useCallback(async () => {
    if (!statementText.trim() || !statementAccountId) {
      toast.error('Choose an account and paste statement text first.');
      return;
    }

    try {
      const result = await parseStatement.mutateAsync({
        text: statementText,
        accountId: statementAccountId,
      });
      const data = result.data;
      if (!data) return;

      setRows(data.transactions.map((tx) => ({
        id: crypto.randomUUID(),
        date: formatDateInput(tx.date),
        name: tx.name,
        amount: String(tx.amount.toFixed(2)),
        account_id: statementAccountId,
        subcategory_id: tx.subcategory_id ?? '',
        comment: tx.needsReview ? 'Needs review' : '',
        isDuplicate: tx.isDuplicate,
        transferMatch: null,
        categorizationSource: tx.categorizationSource,
        aiConfidence: tx.aiConfidence,
        aiSuggestedSubcategoryId: tx.categorizationSource === 'ai' ? tx.subcategory_id : null,
      })));
      setDuplicatesChecked(data.summary.duplicates > 0);
      setParseSummary(
        `${data.summary.total} parsed, ${data.summary.duplicates} duplicate(s), ${data.summary.uncategorized} uncategorized, ${Math.round(data.parseSuccessRate * 100)}% success`,
      );
      toast.success(`Parsed ${data.summary.total} transaction(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Statement parsing failed.');
    }
  }, [parseStatement, statementAccountId, statementText]);

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
        const hasDuplicates = dupData.some(Boolean);

        if (hasDuplicates) {
          // Mark duplicate rows
          setRows((prev) => {
            const filledIds = filledRows.map((r) => r.id);
            let filledIdx = 0;
            return prev.map((r) => {
              if (filledIds.includes(r.id)) {
                const isDup = dupData[filledIdx] ?? false;
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
        ai_suggested: r.categorizationSource === 'ai',
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
        <Button size="sm" variant="secondary" onClick={handleAICategorize} loading={categorize.isPending}>
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          AI Categorize
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

      <Card className="p-3">
        <CardHeader className="mb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" />
            Statement Import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={statementAccountId}
              onChange={(e) => setStatementAccountId(e.target.value)}
              className="h-8 rounded border border-border bg-input px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select account</option>
              {accountOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={handleParseStatement} loading={parseStatement.isPending}>
              Parse Statement
            </Button>
            {lastRunId && (
              <span className="self-center text-xs text-muted-foreground">
                log: logs/{lastRunId}.jsonl
              </span>
            )}
          </div>
          <textarea
            value={statementText}
            onChange={(e) => setStatementText(e.target.value)}
            placeholder="Paste statement lines here"
            className="min-h-20 w-full rounded border border-border bg-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {parseSummary && <p className="text-xs text-muted-foreground">{parseSummary}</p>}
        </CardContent>
      </Card>

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
                    onChange={(val) => handleSubcategoryChange(row, val)}
                    categories={categories}
                    subcategories={subcategories}
                    filterType={getSubcategoryFilter(row.amount)}
                    className="w-36"
                  />
                  {row.categorizationSource !== 'manual' && (
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {row.categorizationSource}
                      {row.aiConfidence != null ? ` ${Math.round(row.aiConfidence * 100)}%` : ''}
                    </div>
                  )}
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
