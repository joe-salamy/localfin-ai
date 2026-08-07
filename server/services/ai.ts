import crypto from "node:crypto";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { appendConversationLog } from "../ai/conversation-log.js";
import { AI_CONFIG, AI_MODELS } from "../config/app.js";
import { createOpenRouterChatModel } from "../ai/model.js";
import type {
  AccountType,
  CategorizeResult,
  CategoryType,
  TransactionKind,
} from "../../shared/contracts/index.js";
import { inferTransactionKindForAccount } from "../../shared/finance/transactionAmounts.js";
type StructuredCategorizer = {
  batch(
    inputs: unknown[],
    config: undefined,
    options: {
      maxConcurrency: number;
      returnExceptions: boolean;
    },
  ): Promise<unknown[]>;
};

interface CategorizeTransactionInput {
  name: string;
  account_id: string;
  account_name: string;
  account_type?: AccountType;
  amount: number;
  date?: string;
}

interface CategorizeRequest {
  transactions: CategorizeTransactionInput[];
  conversationId?: string;
}

interface SubcategoryRow {
  id: string;
  name: string;
  category_name: string;
  category_type: CategoryType;
}

type AvailableSubcategoryChoice = SubcategoryRow;

interface PastExampleRow {
  name: string;
  amount: number;
  account_name: string;
  account_type: AccountType;
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

interface UnknownTransaction extends CategorizeTransactionInput {
  index: number;
}

const TRANSFER_NAME_PATTERN =
  /\b(?:transfer|online transfer|credit card payment|payment thank you|autopay|ach payment|card payment|payment received|payment posted)\b/i;

export const categorizationSchema = z.strictObject({
  results: z
    .array(
      z.strictObject({
        kind: z
          .enum(["income", "expense", "transfer"])
          .describe("The transaction kind in input order."),
        subcategory_id: z
          .string()
          .nullable()
          .describe("The exact available subcategory id, or null."),
      }),
    )
    .max(AI_CONFIG.batchSize)
    .describe("One result per transaction, in the same order as the input."),
});

type CategorizationOutput = z.infer<typeof categorizationSchema>;

export async function categorizeTransactions(
  request: CategorizeRequest,
): Promise<CategorizeResult[]> {
  const db = getDb();
  const results: CategorizeResult[] = new Array(request.transactions.length);
  const unknowns: UnknownTransaction[] = [];

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
        subcategory_id:
          pastTx.kind === "transfer" ? null : pastTx.subcategory_id,
        subcategory_name:
          pastTx.kind === "transfer" ? null : pastTx.subcategory_name,
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

    unknowns.push({ index: i, ...tx });
    results[i] = {
      transaction_name: tx.name,
      kind: getTransactionCategoryType(tx.amount, tx.account_type),
      subcategory_id: null,
      subcategory_name: null,
      category_name: null,
      source: "none",
    };
  }

  if (unknowns.length === 0) return results;

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
      SELECT t.name, t.amount, t.kind, a.name as account_name, a.type as account_type, s.name as subcategory_name, c.name as category_name
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id AND a.deleted_at IS NULL
      LEFT JOIN subcategories s ON t.subcategory_id = s.id AND s.deleted_at IS NULL
      LEFT JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND (t.kind = 'transfer' OR t.subcategory_id IS NOT NULL)
      ORDER BY t.date DESC LIMIT ?
    `,
    )
    .all(AI_CONFIG.contextSize) as PastExampleRow[];

  await processCategorizationBatches(
    unknowns,
    results,
    subcategories,
    pastExamples,
    request.conversationId ?? crypto.randomUUID(),
  );
  return results;
}

function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

class CategorizationFailure extends Error {
  constructor(name: string) {
    super();
    this.name = name;
  }
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

interface CategorizationBatchLog {
  requestId: string;
  batchIndex: number;
  batchCount: number;
  batchSize: number;
  unknownIndexes: number[];
  durationMs: number;
  errorClass?: string;
}

async function appendCategorizationLog(
  entry: CategorizationBatchLog,
): Promise<void> {
  try {
    await appendConversationLog(entry.requestId, {
      operation: "transaction.categorize",
      model: AI_MODELS.transactionCategorization,
      request_id: entry.requestId,
      duration_ms: entry.durationMs,
      batch_index: entry.batchIndex,
      batch_count: entry.batchCount,
      batch_size: entry.batchSize,
      unknown_indexes: entry.unknownIndexes,
      ...(entry.errorClass
        ? { status: "error", error_class: entry.errorClass }
        : { status: "success" }),
    });
  } catch {
    // Categorization logging must never change the categorization result.
  }
}

async function processCategorizationBatches(
  unknowns: UnknownTransaction[],
  results: CategorizeResult[],
  subcategories: SubcategoryRow[],
  pastExamples: PastExampleRow[],
  requestId: string,
): Promise<void> {
  const batches = createBatches(unknowns, AI_CONFIG.batchSize);
  const batchCount = batches.length;
  const availableSubcategories = buildAvailableSubcategoryChoices(subcategories);
  const promptInputs = batches.map((batch) => {
    const { systemMessage, userMessage } = buildCategorizationMessages(
      batch,
      availableSubcategories,
      pastExamples,
    );
    return [
      { role: "system" as const, content: systemMessage },
      { role: "user" as const, content: userMessage },
    ];
  });

  const logBatch = async (
    batchIndex: number,
    startedAt: number,
    failure?: unknown,
  ) => {
    const batch = batches[batchIndex];
    const failureClass = failure
      ? errorClass(failure)
      : undefined;
    if (failureClass) {
      console.error("AI categorization batch failed", {
        batch: batchIndex + 1,
        error: failureClass,
      });
    }
    await appendCategorizationLog({
      requestId,
      batchIndex: batchIndex + 1,
      batchCount,
      batchSize: batch.length,
      unknownIndexes: batch.map((transaction) => transaction.index),
      durationMs: Math.max(0, Date.now() - startedAt),
      errorClass: failureClass,
    });
  };

  const startedAt = Date.now();
  let structuredCategorizer: StructuredCategorizer;
  try {
    structuredCategorizer = createOpenRouterChatModel(
      AI_MODELS.transactionCategorization,
    ).withStructuredOutput(categorizationSchema, {
      method: "functionCalling",
      includeRaw: false,
      name: "categorize_transactions",
    });
  } catch (error) {
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      await logBatch(batchIndex, startedAt, error);
    }
    return;
  }

  let outputs: unknown[];
  try {
    outputs = await structuredCategorizer.batch(promptInputs, undefined, {
      maxConcurrency: AI_CONFIG.maxConcurrentLLMRequests,
      returnExceptions: true,
    });
  } catch (error) {
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      await logBatch(batchIndex, startedAt, error);
    }
    return;
  }

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    const output = outputs[batchIndex];
    if (output instanceof Error || output === undefined) {
      await logBatch(
        batchIndex,
        startedAt,
        output instanceof Error
          ? output
          : new CategorizationFailure("MissingCategorizationOutput"),
      );
      continue;
    }

    const parsed = categorizationSchema.safeParse(output);
    if (!parsed.success) {
      await logBatch(
        batchIndex,
        startedAt,
        new CategorizationFailure("InvalidCategorizationOutput"),
      );
      continue;
    }

    applyCategorizationOutput(
      parsed.data,
      batches[batchIndex],
      availableSubcategories,
      results,
    );
    await logBatch(batchIndex, startedAt);
  }
}

function applyCategorizationOutput(
  output: CategorizationOutput,
  batch: UnknownTransaction[],
  availableSubcategories: AvailableSubcategoryChoice[],
  results: CategorizeResult[],
): void {
  for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
    const transaction = batch[batchIndex];
    const item = output.results[batchIndex];
    const inferredKind = getTransactionCategoryType(
      transaction.amount,
      transaction.account_type,
    );
    const kind = item?.kind ?? inferredKind;

    if (item?.kind === "transfer") {
      results[transaction.index] = {
        transaction_name: transaction.name,
        kind: "transfer",
        subcategory_id: null,
        subcategory_name: null,
        category_name: null,
        source: "ai",
      };
      continue;
    }

    const subcategory = item
      ? availableSubcategories.find(
          (candidate) =>
            candidate.id === item.subcategory_id &&
            candidate.category_type === kind,
        )
      : undefined;
    const fallback =
      subcategory ??
      availableSubcategories.find(
        (candidate) =>
          candidate.name === "Unassigned" && candidate.category_type === kind,
      );

    if (!fallback) continue;
    results[transaction.index] = {
      transaction_name: transaction.name,
      kind,
      subcategory_id: fallback.id,
      subcategory_name: fallback.name,
      category_name: fallback.category_name,
      source: "ai",
    };
  }
}

export function buildAvailableSubcategoryChoices(
  subcategories: SubcategoryRow[],
): AvailableSubcategoryChoice[] {
  return subcategories.map((subcategory) => ({ ...subcategory }));
}

export function formatAvailableSubcategories(
  availableSubcategories: AvailableSubcategoryChoice[],
): string {
  return availableSubcategories
    .map(
      (subcategory) =>
        `${subcategory.id} [${subcategory.category_type}] ${subcategory.category_name} > ${subcategory.name}`,
    )
    .join("\n");
}

export function buildCategorizationMessages(
  batch: UnknownTransaction[],
  availableSubcategories: AvailableSubcategoryChoice[],
  pastExamples: PastExampleRow[],
): { systemMessage: string; userMessage: string } {
  const exampleLines = pastExamples.map((example) => {
    if (example.kind === "transfer") {
      return `"${example.name}" ($${example.amount}) on "${example.account_name}" -> transfer, no subcategory`;
    }
    return `"${example.name}" ($${example.amount}) on "${example.account_name}" -> ${example.kind}, "${example.category_name} > ${example.subcategory_name}"`;
  });

  const systemMessage = `You are a transaction categorizer for a personal budget app. Categorize each transaction into the most appropriate available subcategory.

RULES:
- Amounts are account-balance deltas: asset-account expenses are negative, asset-account income is positive, liability-account expenses/charges are positive, and liability-account payments/refunds/income are negative
- Transfers are money moving between owned accounts, including card payments, ACH transfers, autopay payments, and payment-thank-you lines
- Return one result per input transaction in the same order
- kind must be income, expense, or transfer
- Transfers must return kind transfer and subcategory_id null
- Use only an exact subcategory id from the available list when its category type matches kind
- If unsure, return the Unassigned subcategory id for the appropriate type
- Return only the structured result
AVAILABLE SUBCATEGORIES:
${formatAvailableSubcategories(availableSubcategories)}
${
  exampleLines.length > 0
    ? `\nPAST EXAMPLES:\n${exampleLines.join("\n")}\n`
    : ""
}`;

  const transactionLines = batch.map(
    (transaction) =>
      `- "${transaction.name}" ($${transaction.amount}) on ${transaction.account_type ?? "asset"} account "${transaction.account_name}"`,
  );
  const userMessage = `Categorize these transactions:\n${transactionLines.join("\n")}\n\nReturn exactly one result per transaction in input order.`;
  return { systemMessage, userMessage };
}

function getTransactionCategoryType(
  amount: number,
  accountType: AccountType = "asset",
): "income" | "expense" {
  return inferTransactionKindForAccount(amount, accountType);
}

function isLikelyTransfer(
  tx: CategorizeTransactionInput,
  batchTransactions: CategorizeTransactionInput[] = [],
): boolean {
  if (TRANSFER_NAME_PATTERN.test(tx.name)) return true;
  if (!tx.date) return false;

  if (
    batchTransactions.some(
      (candidate) =>
        candidate !== tx &&
        candidate.account_id !== tx.account_id &&
        candidate.amount === -tx.amount &&
        typeof candidate.date === "string" &&
        Math.abs(
          (new Date(candidate.date).getTime() - new Date(tx.date!).getTime()) /
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
  return Boolean(row);
}
