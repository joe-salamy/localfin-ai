import { z } from "zod";
import { transactionKindSchema, type TransactionKind } from "./transactions.js";

export interface ParsedTransaction {
  date: string;
  name: string;
  amount: number;
  needsReview: boolean;
  confidence: number;
  originalLine: string;
}

export interface EnrichedTransaction extends ParsedTransaction {
  kind: TransactionKind;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  categorizationSource: "lookup" | "ai" | "none";
  isDuplicate: boolean;
}

export interface ParseStatementResult {
  transactions: EnrichedTransaction[];
  summary: {
    total: number;
    duplicates: number;
    fromLookup: number;
    fromAI: number;
    uncategorized: number;
    needsReview: number;
  };
  format: string | null;
  parseSuccessRate: number;
  errors: string[];
}

const parsedTransactionSchema = z.object({
  date: z.string(),
  name: z.string(),
  amount: z.number(),
  needsReview: z.boolean(),
  confidence: z.number(),
  originalLine: z.string(),
});

export const enrichedTransactionSchema: z.ZodType<EnrichedTransaction> =
  parsedTransactionSchema.extend({
    kind: transactionKindSchema,
    subcategory_id: z.string().nullable(),
    subcategory_name: z.string().nullable(),
    category_name: z.string().nullable(),
    categorizationSource: z.enum(["lookup", "ai", "none"]),
    isDuplicate: z.boolean(),
  });

export const parseStatementResultSchema: z.ZodType<ParseStatementResult> =
  z.object({
    transactions: z.array(enrichedTransactionSchema),
    summary: z.object({
      total: z.number(),
      duplicates: z.number(),
      fromLookup: z.number(),
      fromAI: z.number(),
      uncategorized: z.number(),
      needsReview: z.number(),
    }),
    format: z.string().nullable(),
    parseSuccessRate: z.number(),
    errors: z.array(z.string()),
  });
