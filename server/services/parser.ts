import type { EnrichedTransaction, ParsedTransaction } from '../../src/types/index.js';
import { getDb } from '../db/index.js';
import { categorizeTransactions } from './ai.js';

// ---------- Format detection ----------

interface FormatMatch {
  name: string;
  pattern: RegExp;
}

const FORMATS: FormatMatch[] = [
  {
    name: 'credit-card',
    pattern: /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+([-]?\$?[\d,]+\.?\d*)\s*$/,
  },
  {
    name: 'csv',
    pattern: /^"?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)"?\s*,\s*"?([^",]+)"?\s*,\s*"?([-]?\$?[\d,]+\.?\d*)"?\s*$/,
  },
  {
    name: 'tab-separated',
    pattern: /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\t+(.+?)\t+([-]?\$?[\d,]+\.?\d*)/,
  },
  {
    name: 'iso-date',
    pattern: /^(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-]?\$?[\d,]+\.?\d*)\s*$/,
  },
];

const LENIENT_PATTERN = /^(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\s*[,\t]?\s*(.+?)\s+(\(?-?\$?[\d,]+\.?\d*\)?\s*(?:CR|DR)?)\s*$/i;

// ---------- Date parsing ----------

function parseDate(raw: string): string {
  const trimmed = raw.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // MM/DD/YYYY or MM/DD/YY or MM/DD
  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    let year: string;

    if (!slashMatch[3]) {
      year = String(new Date().getFullYear());
    } else if (slashMatch[3].length === 2) {
      const twoDigit = parseInt(slashMatch[3], 10);
      year = twoDigit >= 70 ? `19${slashMatch[3]}` : `20${slashMatch[3].padStart(2, '0')}`;
    } else {
      year = slashMatch[3];
    }

    return `${year}-${month}-${day}`;
  }

  return trimmed;
}

// ---------- Amount parsing ----------

function parseAmount(raw: string): number {
  let str = raw.trim();

  // Handle DR/CR suffix
  const isDebit = /DR$/i.test(str);
  const isCredit = /CR$/i.test(str);
  str = str.replace(/\s*(DR|CR)\s*$/i, '');

  // Handle parentheses for negative: (123.45)
  const parenMatch = str.match(/^\((.+)\)$/);
  let negative = false;
  if (parenMatch) {
    str = parenMatch[1];
    negative = true;
  }

  // Handle leading minus
  if (str.startsWith('-')) {
    negative = true;
    str = str.slice(1);
  }

  // Remove $ and commas
  str = str.replace(/[$,]/g, '');

  let value = parseFloat(str);
  if (isNaN(value)) return 0;

  if (negative) value = -value;
  if (isDebit && value > 0) value = -value;
  if (isCredit && value < 0) value = -value;

  return Math.round(value * 100) / 100;
}

// ---------- Name cleaning ----------

const PREFIX_PATTERN = /^(?:POS|ACH|CHECK|DEBIT|CREDIT|PURCHASE)\s+/i;
const TRAILING_REF_PATTERN = /\s+\d{6,}$/;

function cleanName(raw: string): string {
  let name = raw.trim();
  // Collapse whitespace
  name = name.replace(/\s+/g, ' ');
  // Remove common prefixes
  name = name.replace(PREFIX_PATTERN, '');
  // Remove trailing reference numbers
  name = name.replace(TRAILING_REF_PATTERN, '');
  return name.trim();
}

// ---------- Duplicate checking ----------

function checkDuplicatesInDb(
  transactions: Array<{ date: string; name: string; amount: number }>,
  accountId: string,
): boolean[] {
  const db = getDb();

  const stmt = db.prepare(`
    SELECT COUNT(*) AS cnt FROM transactions
    WHERE date = ? AND name = ? AND amount = ? AND account_id = ? AND deleted_at IS NULL
  `);

  return transactions.map((t) => {
    const row = stmt.get(t.date, t.name, t.amount, accountId) as { cnt: number };
    return row.cnt > 0;
  });
}

// ---------- Main export ----------

export async function parseStatement(
  text: string,
  accountId: string,
): Promise<{
  transactions: EnrichedTransaction[];
  summary: {
    total: number;
    duplicates: number;
    fromLookup: number;
    fromCorrection: number;
    fromAI: number;
    uncategorized: number;
    needsReview: number;
  };
  format: string | null;
  parseSuccessRate: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      transactions: [],
      summary: { total: 0, duplicates: 0, fromLookup: 0, fromCorrection: 0, fromAI: 0, uncategorized: 0, needsReview: 0 },
      format: null,
      parseSuccessRate: 0,
      errors: ['No lines found in input text'],
    };
  }

  // Detect format using first non-header line candidates
  let detectedFormat: FormatMatch | null = null;
  for (const line of lines.slice(0, 3)) {
    for (const fmt of FORMATS) {
      if (fmt.pattern.test(line)) {
        detectedFormat = fmt;
        break;
      }
    }
    if (detectedFormat) break;
  }

  // Parse lines
  const parsed: ParsedTransaction[] = [];
  let failedLines = 0;

  for (const line of lines) {
    const pattern = detectedFormat?.pattern ?? null;
    let match: RegExpMatchArray | null = null;

    if (pattern) {
      match = line.match(pattern);
    }

    // Fallback to lenient pattern
    if (!match) {
      match = line.match(LENIENT_PATTERN);
    }

    if (!match) {
      failedLines++;
      if (failedLines <= 5) {
        errors.push(`Could not parse line: "${line.slice(0, 80)}"`);
      }
      continue;
    }

    const rawDate = match[1];
    const rawName = match[2];
    const rawAmount = match[3];

    const date = parseDate(rawDate);
    const amount = parseAmount(rawAmount);
    const name = cleanName(rawName);

    if (!name) {
      failedLines++;
      errors.push(`Empty name after cleaning: "${line.slice(0, 80)}"`);
      continue;
    }

    const needsReview = amount === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date);

    parsed.push({
      date,
      name,
      amount,
      needsReview,
      confidence: needsReview ? 0.5 : 1.0,
      originalLine: line,
    });
  }

  if (failedLines > 5) {
    errors.push(`... and ${failedLines - 5} more unparseable lines`);
  }

  // Check duplicates
  const duplicateFlags = checkDuplicatesInDb(
    parsed.map((t) => ({ date: t.date, name: t.name, amount: t.amount })),
    accountId,
  );

  // Resolve account name for AI categorization
  const db = getDb();
  const accountRow = db.prepare('SELECT name FROM accounts WHERE id = ?').get(accountId) as { name: string } | undefined;
  const accountName = accountRow?.name ?? 'Unknown';

  // Categorize using the AI service pipeline (corrections > lookup > AI batch)
  const catResults = await categorizeTransactions({
    transactions: parsed.map((t) => ({
      name: t.name,
      account_id: accountId,
      account_name: accountName,
      amount: t.amount,
    })),
  });

  // Build summary and enriched transactions
  const summary = {
    total: parsed.length,
    duplicates: 0,
    fromLookup: 0,
    fromCorrection: 0,
    fromAI: 0,
    uncategorized: 0,
    needsReview: 0,
  };

  const enriched: EnrichedTransaction[] = parsed.map((t, i) => {
    const isDuplicate = duplicateFlags[i];
    if (isDuplicate) summary.duplicates++;

    const cat = catResults[i];
    const source = cat?.source ?? 'none';

    switch (source) {
      case 'lookup':
        summary.fromLookup++;
        break;
      case 'correction':
        summary.fromCorrection++;
        break;
      case 'ai':
        summary.fromAI++;
        break;
      case 'none':
        summary.uncategorized++;
        break;
    }

    if (t.needsReview) summary.needsReview++;

    return {
      ...t,
      subcategory_id: cat?.subcategory_id ?? null,
      subcategory_name: cat?.subcategory_name ?? null,
      category_name: cat?.category_name ?? null,
      categorizationSource: source,
      isDuplicate,
      aiConfidence: cat?.confidence ?? 0,
    };
  });

  const totalLines = lines.length;
  const parseSuccessRate = totalLines > 0 ? parsed.length / totalLines : 0;

  return {
    transactions: enriched,
    summary,
    format: detectedFormat?.name ?? (parsed.length > 0 ? 'lenient' : null),
    parseSuccessRate: Math.round(parseSuccessRate * 1000) / 1000,
    errors,
  };
}
