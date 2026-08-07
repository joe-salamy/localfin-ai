import { z } from "zod";
import { tagTypeSchema, type Tag } from "./tags.js";
import type { AccountType } from "./accounts.js";

export type TransactionKind = "income" | "expense" | "transfer" | "adjustment";

export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  name: string;
  amount: number;
  kind: TransactionKind;
  subcategory_id: string | null;
  comment: string | null;
  is_initial_balance: boolean;
  ai_suggested: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TransactionWithDetails extends Transaction {
  account_name?: string;
  account_type?: string;
  account_color?: string | null;
  subcategory_name?: string;
  subcategory_color?: string | null;
  category_id?: string;
  category_name?: string;
  category_type?: string;
  category_color?: string | null;
  running_balance?: number;
  tags: Tag[];
}

export interface RecentAccountTransaction {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  account_color: string | null;
  current_balance: number;
  last_transaction_id: string | null;
  last_transaction_date: string | null;
  last_transaction_name: string | null;
  last_transaction_amount: number | null;
}

export interface TransactionFilters {
  accountId?: string;
  accountIds?: string[];
  categoryIds?: string[];
  subcategoryId?: string;
  subcategoryIds?: string[];
  tagIds?: string[];
  kind?: TransactionKind;
  needsCategory?: boolean;
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

export type SuspectFindingStatus = "open" | "dismissed" | "resolved";
export const suspectFindingStatusSchema = z.enum([
  "open",
  "dismissed",
  "resolved",
]);

export type SuspectSeverity = "low" | "medium" | "high";
export const suspectSeveritySchema = z.enum(["low", "medium", "high"]);

export type SuspectReasonCode =
  | "exact_duplicate"
  | "near_duplicate"
  | "large_amount_outlier"
  | "merchant_amount_outlier"
  | "rapid_small_charge_cluster"
  | "missing_category"
  | "unmatched_transfer_like"
  | "flagged_word";
export const suspectReasonCodeSchema = z.enum([
  "exact_duplicate",
  "near_duplicate",
  "large_amount_outlier",
  "merchant_amount_outlier",
  "rapid_small_charge_cluster",
  "missing_category",
  "unmatched_transfer_like",
  "flagged_word",
]);

export interface SuspectEvidence {
  summary: string;
  details?: Record<
    string,
    string | number | boolean | null | string[] | number[]
  >;
}

export interface SuspectScanRun {
  id: string;
  filters_json: string;
  total_scanned: number;
  total_findings: number;
  created_at: string;
}

export interface SuspectTransactionFinding {
  id: string;
  scan_run_id: string;
  transaction_id: string;
  status: SuspectFindingStatus;
  severity: SuspectSeverity;
  score: number;
  reason_codes: SuspectReasonCode[];
  evidence: SuspectEvidence;
  created_at: string;
  updated_at: string;
  transaction?: TransactionWithDetails;
}

export interface RunSuspectScanRequest {
  filters?: TransactionFilters;
  flaggedWords?: string[];
}

export interface RunSuspectScanResponse {
  run: SuspectScanRun;
  findings: SuspectTransactionFinding[];
}

export interface SuspectFindingFilters {
  status?: SuspectFindingStatus;
  severity?: SuspectSeverity;
  reason?: SuspectReasonCode;
  runId?: string;
}

export interface CreateTransactionData {
  account_id: string;
  date: string;
  name: string;
  amount: number;
  kind?: TransactionKind;
  subcategory_id?: string | null;
  tag_ids?: string[];
  comment?: string | null;
  ai_suggested?: boolean;
}

export interface UpdateTransactionData extends Partial<CreateTransactionData> {
  tag_ids?: string[];
}

export interface BulkTransactionUpdateData {
  kind?: TransactionKind;
  subcategory_id?: string | null;
  add_tag_ids?: string[];
  remove_tag_ids?: string[];
}

export const transactionKindSchema = z.enum([
  "income",
  "expense",
  "transfer",
  "adjustment",
]);

export const transactionSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  date: z.string(),
  name: z.string(),
  amount: z.number(),
  kind: transactionKindSchema,
  subcategory_id: z.string().nullable(),
  comment: z.string().nullable(),
  is_initial_balance: z.boolean(),
  ai_suggested: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
}) satisfies z.ZodType<Transaction>;

const transactionTagSchema: z.ZodType<Tag> = z.object({
  id: z.string(),
  name: z.string(),
  type: tagTypeSchema,
  color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
});

export const transactionWithDetailsSchema: z.ZodType<TransactionWithDetails> =
  transactionSchema.extend({
    account_name: z.string().optional(),
    account_type: z.string().optional(),
    account_color: z.string().nullable().optional(),
    subcategory_name: z.string().optional(),
    subcategory_color: z.string().nullable().optional(),
    category_id: z.string().optional(),
    category_name: z.string().optional(),
    category_type: z.string().optional(),
    category_color: z.string().nullable().optional(),
    running_balance: z.number().optional(),
    tags: z.array(transactionTagSchema),
  });

export const duplicateCheckResultSchema = z.array(z.boolean());
