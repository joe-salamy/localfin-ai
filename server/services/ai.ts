import { getDb } from '../db/index.js';
import { callOpenRouter } from '../ai/openrouter.js';
import { getAICorrection, getAICorrections } from './ai-corrections.js';

interface CategorizeRequest {
  transactions: { name: string; account_id: string; account_name: string; amount: number }[];
}

interface CategorizeResult {
  transaction_name: string;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  confidence: number;
  source: 'correction' | 'lookup' | 'ai' | 'none';
}

interface SubcategoryRow {
  id: string;
  name: string;
  category_name: string;
  category_type: string;
}

interface PastExampleRow {
  name: string;
  amount: number;
  account_name: string;
  subcategory_name: string;
  category_name: string;
}

interface SubcategoryLookupRow {
  id: string;
  name: string;
  category_name: string;
}

interface PastTxRow {
  subcategory_id: string;
  subcategory_name: string;
  category_name: string;
}

interface AIResultItem {
  index: number;
  subcategory_id: string;
  subcategory_name: string;
  category_name: string;
  confidence: number;
}

interface CorrectionRow {
  id: string;
  transaction_name: string;
  account_id: string;
  ai_suggested_subcategory_id: string | null;
  user_corrected_subcategory_id: string;
  created_at: string;
}

const AI_BATCH_SIZE = 25;
const AI_CONTEXT_SIZE = 100;

export async function categorizeTransactions(request: CategorizeRequest): Promise<CategorizeResult[]> {
  const db = getDb();
  const results: CategorizeResult[] = [];
  const unknowns: { index: number; name: string; account_id: string; account_name: string; amount: number }[] = [];

  // Step 1: For each transaction, try corrections then lookup
  for (let i = 0; i < request.transactions.length; i++) {
    const tx = request.transactions[i];
    const normalizedName = tx.name.trim().toLowerCase();

    // Check corrections first (highest priority)
    const correction = getAICorrection(normalizedName, tx.account_id);
    if (correction) {
      const sub = db.prepare(
        'SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?'
      ).get(correction.user_corrected_subcategory_id) as SubcategoryLookupRow | undefined;

      if (sub) {
        results[i] = {
          transaction_name: tx.name,
          subcategory_id: sub.id,
          subcategory_name: sub.name,
          category_name: sub.category_name,
          confidence: 1.0,
          source: 'correction',
        };
        continue;
      }
    }

    // Check past transactions with same name + account
    const pastTx = db.prepare(`
      SELECT t.subcategory_id, s.name as subcategory_name, c.name as category_name
      FROM transactions t
      LEFT JOIN subcategories s ON t.subcategory_id = s.id
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE t.account_id = ? AND LOWER(TRIM(t.name)) = ? AND t.subcategory_id IS NOT NULL AND t.deleted_at IS NULL
      ORDER BY t.date DESC LIMIT 1
    `).get(tx.account_id, normalizedName) as PastTxRow | undefined;

    if (pastTx) {
      results[i] = {
        transaction_name: tx.name,
        subcategory_id: pastTx.subcategory_id,
        subcategory_name: pastTx.subcategory_name,
        category_name: pastTx.category_name,
        confidence: 0.95,
        source: 'lookup',
      };
      continue;
    }

    // Mark as unknown for AI batch
    unknowns.push({ index: i, ...tx });
    results[i] = {
      transaction_name: tx.name,
      subcategory_id: null,
      subcategory_name: null,
      category_name: null,
      confidence: 0,
      source: 'none',
    };
  }

  // Step 2: Batch unknowns to LLM
  if (unknowns.length > 0) {
    const subcategories = db.prepare(`
      SELECT s.id, s.name, c.name as category_name, c.type as category_type
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
      WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL
      ORDER BY c.type, c.name, s.name
    `).all() as SubcategoryRow[];

    const pastExamples = db.prepare(`
      SELECT t.name, t.amount, a.name as account_name, s.name as subcategory_name, c.name as category_name
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id
      JOIN subcategories s ON t.subcategory_id = s.id
      JOIN categories c ON s.category_id = c.id
      WHERE t.deleted_at IS NULL AND t.subcategory_id IS NOT NULL
      ORDER BY t.date DESC LIMIT ?
    `).all(AI_CONTEXT_SIZE) as PastExampleRow[];

    const corrections = getAICorrections();

    // Process in batches
    for (let i = 0; i < unknowns.length; i += AI_BATCH_SIZE) {
      const batch = unknowns.slice(i, i + AI_BATCH_SIZE);

      try {
        const aiResults = await callOpenRouterForCategorization(batch, subcategories, pastExamples, corrections);

        for (let j = 0; j < batch.length; j++) {
          const aiResult = aiResults[j];
          if (aiResult && aiResult.subcategory_id) {
            results[batch[j].index] = {
              transaction_name: batch[j].name,
              subcategory_id: aiResult.subcategory_id,
              subcategory_name: aiResult.subcategory_name,
              category_name: aiResult.category_name,
              confidence: aiResult.confidence || 0.7,
              source: 'ai',
            };
          }
        }
      } catch (error) {
        console.error('AI categorization batch failed:', error);
        // Leave unknowns as 'none' source
      }
    }
  }

  return results;
}

async function callOpenRouterForCategorization(
  batch: { index: number; name: string; account_id: string; account_name: string; amount: number }[],
  subcategories: SubcategoryRow[],
  pastExamples: PastExampleRow[],
  corrections: CorrectionRow[],
): Promise<AIResultItem[]> {
  const db = getDb();

  // Build subcategory list grouped by type
  const incomeSubcategories = subcategories
    .filter((s) => s.category_type === 'income')
    .map((s) => `  - ${s.category_name} > ${s.name} (id: ${s.id})`)
    .join('\n');

  const expenseSubcategories = subcategories
    .filter((s) => s.category_type === 'expense')
    .map((s) => `  - ${s.category_name} > ${s.name} (id: ${s.id})`)
    .join('\n');

  // Build corrections context
  const correctionLines = corrections.map((c) => {
    const sub = db.prepare(
      'SELECT s.name as subcategory_name, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?'
    ).get(c.user_corrected_subcategory_id) as { subcategory_name: string; category_name: string } | undefined;

    const account = db.prepare('SELECT name FROM accounts WHERE id = ?').get(c.account_id) as { name: string } | undefined;

    if (!sub || !account) return null;
    return `"${c.transaction_name}" on account "${account.name}" -> subcategory "${sub.category_name} > ${sub.subcategory_name}"`;
  }).filter(Boolean);

  // Build past examples context
  const exampleLines = pastExamples.map(
    (e) => `"${e.name}" ($${e.amount}) on "${e.account_name}" -> "${e.category_name} > ${e.subcategory_name}"`
  );

  const systemMessage = `You are a transaction categorizer for a personal budget app. Categorize each transaction into the most appropriate subcategory.

RULES:
- Positive amounts are income, negative amounts are expenses
- Match the subcategory type to the transaction direction (income subcategories for positive, expense for negative)
- If unsure, use "Unassigned" for the appropriate type
- Return ONLY the JSON, no explanation
${correctionLines.length > 0 ? `
USER CORRECTIONS (MUST follow these exactly):
${correctionLines.join('\n')}
` : ''}
AVAILABLE SUBCATEGORIES:
Income:
${incomeSubcategories}
Expense:
${expenseSubcategories}
${exampleLines.length > 0 ? `
PAST EXAMPLES:
${exampleLines.join('\n')}
` : ''}`;

  const transactionLines = batch.map(
    (tx, i) => `${i + 1}. "${tx.name}" ($${tx.amount}) on account "${tx.account_name}"`
  );

  const userMessage = `Categorize these transactions:
${transactionLines.join('\n')}

Return JSON: { "results": [{ "index": 0, "subcategory_id": "...", "subcategory_name": "...", "category_name": "...", "confidence": 0.8 }] }`;

  const responseText = await callOpenRouter([
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ]);

  // Parse response
  let parsed: { results: AIResultItem[] };
  try {
    parsed = JSON.parse(responseText) as { results: AIResultItem[] };
  } catch {
    console.error('Failed to parse AI response:', responseText);
    return [];
  }

  if (!parsed.results || !Array.isArray(parsed.results)) {
    console.error('AI response missing results array:', parsed);
    return [];
  }

  // Validate subcategory IDs and build indexed results
  const validSubcategoryIds = new Set(subcategories.map((s) => s.id));
  const indexedResults: AIResultItem[] = [];

  for (const result of parsed.results) {
    const batchIndex = result.index;
    if (batchIndex < 0 || batchIndex >= batch.length) continue;

    if (result.subcategory_id && validSubcategoryIds.has(result.subcategory_id)) {
      indexedResults[batchIndex] = result;
    } else {
      // Fall back to Unassigned
      const tx = batch[batchIndex];
      const type = tx.amount >= 0 ? 'income' : 'expense';
      const unassigned = subcategories.find(
        (s) => s.name === 'Unassigned' && s.category_type === type
      );
      if (unassigned) {
        indexedResults[batchIndex] = {
          index: batchIndex,
          subcategory_id: unassigned.id,
          subcategory_name: unassigned.name,
          category_name: unassigned.category_name,
          confidence: 0.1,
        };
      }
    }
  }

  return indexedResults;
}
