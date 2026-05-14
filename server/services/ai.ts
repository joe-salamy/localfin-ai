import { getDb } from "../db/index.js";
import { callOpenRouter } from "../ai/openrouter.js";
import { AI_CONFIG, AI_MODELS } from "../config/app.js";
import type { TransactionKind } from "../../src/types/index.js";

interface CategorizeRequest {
  transactions: {
    name: string;
    account_id: string;
    account_name: string;
    amount: number;
    date?: string;
  }[];
  conversationId?: string;
}

interface CategorizeResult {
  transaction_name: string;
  kind: TransactionKind;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  source: "lookup" | "transfer" | "ai" | "none";
}

interface SubcategoryRow {
  id: string;
  name: string;
  category_name: string;
  category_type: string;
}

interface AvailableSubcategoryChoice extends SubcategoryRow {
  number: number;
}

interface PastExampleRow {
  name: string;
  amount: number;
  account_name: string;
  kind: TransactionKind;
  subcategory_name: string | null;
  category_name: string | null;
}

interface PastTxRow {
  kind: TransactionKind;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
}

interface AIResultItem {
  index: number;
  kind?: number | null;
  subcategory?: number | null;
}

interface ResolvedAIResultItem {
  index: number;
  kind: TransactionKind;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
}

interface UnknownTransaction {
  index: number;
  name: string;
  account_id: string;
  account_name: string;
  amount: number;
  date?: string;
}

const KIND_CHOICES: TransactionKind[] = ["income", "expense", "transfer"];
const TRANSFER_NAME_PATTERN =
  /\b(?:transfer|online transfer|credit card payment|payment thank you|autopay|ach payment|card payment|payment received|payment posted)\b/i;

export async function categorizeTransactions(
  request: CategorizeRequest,
): Promise<CategorizeResult[]> {
  const db = getDb();
  const results: CategorizeResult[] = [];
  const unknowns: UnknownTransaction[] = [];

  // Step 1: For each transaction, try past transactions with the same name and account.
  for (let i = 0; i < request.transactions.length; i++) {
    const tx = request.transactions[i];
    const normalizedName = tx.name.trim().toLowerCase();

    const pastTx = db
      .prepare(
        `
      SELECT t.kind, t.subcategory_id, s.name as subcategory_name, c.name as category_name
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
      LEFT JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
      LEFT JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
      WHERE t.account_id = ? AND LOWER(TRIM(t.name)) = ? AND t.deleted_at IS NULL
        AND (t.kind = 'transfer' OR t.subcategory_id IS NOT NULL)
      ORDER BY t.date DESC LIMIT 1
    `,
      )
      .get(tx.account_id, normalizedName) as PastTxRow | undefined;

    if (pastTx) {
      results[i] = {
        transaction_name: tx.name,
        kind: pastTx.kind,
        subcategory_id: pastTx.kind === "transfer" ? null : pastTx.subcategory_id,
        subcategory_name: pastTx.kind === "transfer" ? null : pastTx.subcategory_name,
        category_name: pastTx.kind === "transfer" ? null : pastTx.category_name,
        source: "lookup",
      };
      continue;
    }

    if (isLikelyTransfer(tx, request.transactions)) {
      results[i] = {
        transaction_name: tx.name,
        kind: "transfer",
        subcategory_id: null,
        subcategory_name: null,
        category_name: null,
        source: "transfer",
      };
      continue;
    }

    // Mark as unknown for AI batch
    unknowns.push({ index: i, ...tx });
    results[i] = {
      transaction_name: tx.name,
      kind: getTransactionCategoryType(tx.amount),
      subcategory_id: null,
      subcategory_name: null,
      category_name: null,
      source: "none",
    };
  }

  // Step 2: Batch unknowns to LLM
  if (unknowns.length > 0) {
    const subcategories = db
      .prepare(
        `
      SELECT s.id, s.name, c.name as category_name, c.type as category_type
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
      WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL
      ORDER BY c.type, c.name, s.name
    `,
      )
      .all() as SubcategoryRow[];

    const pastExamples = db
      .prepare(
        `
      SELECT t.name, t.amount, t.kind, a.name as account_name, s.name as subcategory_name, c.name as category_name
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
      LEFT JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
      LEFT JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND (t.kind = 'transfer' OR t.subcategory_id IS NOT NULL)
      ORDER BY t.date DESC LIMIT ?
    `,
      )
      .all(AI_CONFIG.contextSize) as PastExampleRow[];

    await processCategorizationBatches({
      unknowns,
      results,
      subcategories,
      pastExamples,
      conversationId: request.conversationId,
    });
  }

  return results;
}

function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

export function normalizeAIResultIndex(
  resultIndex: unknown,
  batchLength: number,
  usesOneBasedIndexes: boolean,
): number | null {
  if (typeof resultIndex !== "number" || !Number.isInteger(resultIndex)) {
    return null;
  }

  const batchIndex = usesOneBasedIndexes ? resultIndex - 1 : resultIndex;
  if (batchIndex < 0 || batchIndex >= batchLength) {
    return null;
  }

  return batchIndex;
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  processItem: (item: T, itemIndex: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex;
      nextIndex += 1;
      await processItem(items[itemIndex], itemIndex);
    }
  });

  await Promise.all(workers);
}

async function processCategorizationBatches({
  unknowns,
  results,
  subcategories,
  pastExamples,
  conversationId,
}: {
  unknowns: UnknownTransaction[];
  results: CategorizeResult[];
  subcategories: SubcategoryRow[];
  pastExamples: PastExampleRow[];
  conversationId?: string;
}): Promise<void> {
  const batches = createBatches(unknowns, AI_CONFIG.batchSize);
  const concurrency =
    unknowns.length > AI_CONFIG.batchSize ? AI_CONFIG.maxConcurrentLLMRequests : 1;

  await processWithConcurrency(batches, concurrency, async (batch, batchIndex) => {
    try {
      const aiResults = await callOpenRouterForCategorization(
        batch,
        subcategories,
        pastExamples,
        conversationId,
        {
          batchNumber: batchIndex + 1,
          batchCount: batches.length,
        },
      );

      for (let j = 0; j < batch.length; j++) {
        const aiResult = aiResults[j];
        if (aiResult) {
          results[batch[j].index] = {
            transaction_name: batch[j].name,
            kind: aiResult.kind,
            subcategory_id: aiResult.subcategory_id,
            subcategory_name: aiResult.subcategory_name,
            category_name: aiResult.category_name,
            source: "ai",
          };
        }
      }
    } catch (error) {
      console.error("AI categorization batch failed:", error);
      // Leave unknowns in this batch as 'none' source.
    }
  });
}

async function callOpenRouterForCategorization(
  batch: UnknownTransaction[],
  subcategories: SubcategoryRow[],
  pastExamples: PastExampleRow[],
  conversationId?: string,
  batchMetadata?: {
    batchNumber: number;
    batchCount: number;
  },
): Promise<ResolvedAIResultItem[]> {
  const availableSubcategories = buildAvailableSubcategoryChoices(subcategories);
  const { systemMessage, userMessage } = buildCategorizationMessages(
    batch,
    availableSubcategories,
    pastExamples,
  );

  const response = await callOpenRouter(
    [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
    {
      conversationId,
      operation: "transaction.categorize",
      model: AI_MODELS.transactionCategorization,
      metadata: {
        batchSize: batch.length,
        unknownIndexes: batch.map((tx) => tx.index),
        ...batchMetadata,
      },
    },
  );

  return resolveAIResults(
    response.parsedContent as { results: AIResultItem[] } | null,
    response.content,
    batch,
    availableSubcategories,
  );
}

export function buildAvailableSubcategoryChoices(
  subcategories: SubcategoryRow[],
): AvailableSubcategoryChoice[] {
  return subcategories.map((subcategory, index) => ({
    ...subcategory,
    number: index,
  }));
}

export function formatAvailableSubcategories(
  availableSubcategories: AvailableSubcategoryChoice[],
): string {
  return availableSubcategories
    .map(
      (subcategory) =>
        `${subcategory.number}. [${subcategory.category_type}] ${subcategory.category_name} > ${subcategory.name}`,
    )
    .join("\n");
}

export function buildCategorizationMessages(
  batch: UnknownTransaction[],
  availableSubcategories: AvailableSubcategoryChoice[],
  pastExamples: PastExampleRow[],
): { systemMessage: string; userMessage: string } {
  // Build past examples context
  const exampleLines = pastExamples.map((e) => {
    if (e.kind === "transfer") {
      return `"${e.name}" ($${e.amount}) on "${e.account_name}" -> kind 2 transfer, no subcategory`;
    }
    const kindIndex = e.kind === "income" ? 0 : 1;
    return `"${e.name}" ($${e.amount}) on "${e.account_name}" -> kind ${kindIndex} ${e.kind}, "${e.category_name} > ${e.subcategory_name}"`;
  });

  const systemMessage = `You are a transaction categorizer for a personal budget app. Categorize each transaction into the most appropriate subcategory.

RULES:
- Positive amounts are income, negative amounts are expenses
- Transfers are money moving between owned accounts, including card payments, ACH transfers, autopay payments, and payment-thank-you lines
- Return kind as a numeric index: 0 = income, 1 = expense, 2 = transfer
- Transfers must return kind 2 and subcategory null
- Match the subcategory number to the transaction direction (income subcategories for positive, expense for negative)
- If unsure, use the "Unassigned" subcategory number for the appropriate type
- Return numeric values only; do not return category, subcategory, or kind names
- Return ONLY the JSON, no explanation
AVAILABLE SUBCATEGORIES:
${formatAvailableSubcategories(availableSubcategories)}
${
  exampleLines.length > 0
    ? `
PAST EXAMPLES:
${exampleLines.join("\n")}
`
    : ""
}`;

  const transactionLines = batch.map(
    (tx, i) =>
      `- index ${i}: "${tx.name}" ($${tx.amount}) on account "${tx.account_name}"`,
  );

  const userMessage = `Categorize these transactions:
${transactionLines.join("\n")}

Return exactly one result per transaction using the same zero-based index values shown above.
Return JSON: { "results": [{ "index": 0, "kind": 0, "subcategory": 0 }] }`;

  return { systemMessage, userMessage };
}

export function resolveSubcategoryChoice(
  choice: unknown,
  kind: "income" | "expense",
  availableSubcategories: AvailableSubcategoryChoice[],
): AvailableSubcategoryChoice | null {
  if (typeof choice === "number" && Number.isInteger(choice)) {
    const subcategory = availableSubcategories[choice];
    if (subcategory?.category_type === kind) {
      return subcategory;
    }
  }

  return findUnassignedSubcategory(availableSubcategories, kind);
}

export function resolveKindChoice(
  choice: unknown,
  transactionAmount: number,
): TransactionKind {
  if (typeof choice === "number" && Number.isInteger(choice)) {
    return KIND_CHOICES[choice] ?? getTransactionCategoryType(transactionAmount);
  }
  return getTransactionCategoryType(transactionAmount);
}

function resolveAIResults(
  parsed: { results: AIResultItem[] } | null,
  responseContent: string,
  batch: UnknownTransaction[],
  availableSubcategories: AvailableSubcategoryChoice[],
): ResolvedAIResultItem[] {
  if (!parsed) {
    console.error("Failed to parse AI response:", responseContent);
    return [];
  }

  if (!parsed.results || !Array.isArray(parsed.results)) {
    console.error("AI response missing results array:", parsed);
    return [];
  }

  const indexedResults: ResolvedAIResultItem[] = [];
  const resultIndexes = parsed.results
    .map((result) => result.index)
    .filter((index): index is number => Number.isInteger(index));
  const usesOneBasedIndexes =
    resultIndexes.length > 0 &&
    !resultIndexes.includes(0) &&
    resultIndexes.every((index) => index >= 1 && index <= batch.length);

  for (const result of parsed.results) {
    const batchIndex = normalizeAIResultIndex(
      result.index,
      batch.length,
      usesOneBasedIndexes,
    );
    if (batchIndex === null) continue;

    const kind = resolveKindChoice(result.kind, batch[batchIndex].amount);
    if (kind === "transfer") {
      indexedResults[batchIndex] = {
        index: batchIndex,
        kind,
        subcategory_id: null,
        subcategory_name: null,
        category_name: null,
      };
      continue;
    }

    const subcategory = resolveSubcategoryChoice(
      result.subcategory,
      kind,
      availableSubcategories,
    );
    if (subcategory) {
      indexedResults[batchIndex] = {
        index: batchIndex,
        kind,
        subcategory_id: subcategory.id,
        subcategory_name: subcategory.name,
        category_name: subcategory.category_name,
      };
    }
  }

  for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
    if (indexedResults[batchIndex]) continue;

    const kind = getTransactionCategoryType(batch[batchIndex].amount);
    const subcategory = resolveSubcategoryChoice(null, kind, availableSubcategories);
    if (subcategory) {
      indexedResults[batchIndex] = {
        index: batchIndex,
        kind,
        subcategory_id: subcategory.id,
        subcategory_name: subcategory.name,
        category_name: subcategory.category_name,
      };
    }
  }

  return indexedResults;
}

function getTransactionCategoryType(amount: number): "income" | "expense" {
  return amount >= 0 ? "income" : "expense";
}

function isLikelyTransfer(
  tx: CategorizeRequest["transactions"][number],
  batchTransactions: CategorizeRequest["transactions"] = [],
): boolean {
  if (TRANSFER_NAME_PATTERN.test(tx.name)) return true;
  if (!tx.date) return false;
  const txDate = tx.date;

  if (
    batchTransactions.some(
      (candidate) =>
        candidate !== tx &&
        candidate.account_id !== tx.account_id &&
        candidate.amount === -tx.amount &&
        typeof candidate.date === "string" &&
        Math.abs(
          (new Date(candidate.date).getTime() - new Date(txDate).getTime()) /
            86_400_000,
        ) <= 3,
    )
  ) {
    return true;
  }

  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT 1
      FROM transactions
      WHERE account_id != ?
        AND amount = ?
        AND deleted_at IS NULL
        AND date BETWEEN date(?, '-3 days') AND date(?, '+3 days')
      LIMIT 1
    `,
    )
    .get(tx.account_id, -tx.amount, tx.date, tx.date);
  return !!row;
}

function findUnassignedSubcategory(
  availableSubcategories: AvailableSubcategoryChoice[],
  type: "income" | "expense",
): AvailableSubcategoryChoice | null {
  return (
    availableSubcategories.find(
      (subcategory) =>
        subcategory.name === "Unassigned" && subcategory.category_type === type,
    ) ?? null
  );
}
