import { z } from "zod";
import type { AccountType } from "./accounts.js";
import type { CategoryType } from "./categories.js";
import type { TagType } from "./tags.js";

export interface AccountSummary {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  account_color: string | null;
  starting_balance: number;
  total_change: number;
  ending_balance: number;
  transactions: AccountTransaction[];
}

export interface AccountTransaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  running_balance: number;
  subcategory_name: string | null;
  category_name: string | null;
  category_color: string | null;
  subcategory_color: string | null;
}

export interface CategorySummary {
  category_id: string;
  category_name: string;
  category_type: CategoryType;
  category_color: string | null;
  total: number;
  goal: number | null;
  difference: number | null;
  subcategories: SubcategorySummary[];
}

export interface SubcategorySummary {
  subcategory_id: string;
  subcategory_name: string;
  subcategory_color: string | null;
  total: number;
  goal: number | null;
  difference: number | null;
}

export interface TagCategorySummary {
  category_id: string | null;
  category_name: string | null;
  category_type: CategoryType | null;
  category_color: string | null;
  expense_total: number;
  income_total: number;
  net_total: number;
  transaction_count: number;
}

export interface TagSummary {
  tag_id: string;
  tag_name: string;
  tag_type: TagType;
  tag_color: string | null;
  expense_total: number;
  income_total: number;
  net_total: number;
  transaction_count: number;
  categories: TagCategorySummary[];
}

export interface NetWorthSummary {
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
}

export interface AccountSummaryResponse {
  accounts: AccountSummary[];
  netWorth: NetWorthSummary;
}

export interface DashboardMetrics {
  totalIncome: number;
  totalExpenses: number;
  netChange: number;
}

export interface NetWorthDataPoint {
  date: string;
  formattedDate: string;
  netWorth: number;
  accountColors?: Record<string, string>;
  [accountName: string]: string | number | Record<string, string> | undefined;
}

export interface SankeyNode {
  id: string;
  displayName?: string;
  nodeColor?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

const accountTypeSchema = z.enum(["asset", "liability"]);
const categoryTypeSchema = z.enum(["income", "expense"]);
const tagTypeSchema = z.enum([
  "custom",
  "trip",
  "event",
  "person",
  "reimbursable",
  "tax",
]);

const netWorthSummarySchema: z.ZodType<NetWorthSummary> = z.object({
  total_assets: z.number(),
  total_liabilities: z.number(),
  net_worth: z.number(),
});

const accountTransactionSchema: z.ZodType<AccountTransaction> = z.object({
  id: z.string(),
  date: z.string(),
  name: z.string(),
  amount: z.number(),
  running_balance: z.number(),
  subcategory_name: z.string().nullable(),
  category_name: z.string().nullable(),
  category_color: z.string().nullable(),
  subcategory_color: z.string().nullable(),
});

const accountSummarySchema: z.ZodType<AccountSummary> = z.object({
  account_id: z.string(),
  account_name: z.string(),
  account_type: accountTypeSchema,
  account_color: z.string().nullable(),
  starting_balance: z.number(),
  total_change: z.number(),
  ending_balance: z.number(),
  transactions: z.array(accountTransactionSchema),
});

export const accountSummaryResponseSchema: z.ZodType<AccountSummaryResponse> =
  z.object({
    accounts: z.array(accountSummarySchema),
    netWorth: netWorthSummarySchema,
  });

const subcategorySummarySchema: z.ZodType<SubcategorySummary> = z.object({
  subcategory_id: z.string(),
  subcategory_name: z.string(),
  subcategory_color: z.string().nullable(),
  total: z.number(),
  goal: z.number().nullable(),
  difference: z.number().nullable(),
});

export const categorySummarySchema: z.ZodType<CategorySummary> = z.object({
  category_id: z.string(),
  category_name: z.string(),
  category_type: categoryTypeSchema,
  category_color: z.string().nullable(),
  total: z.number(),
  goal: z.number().nullable(),
  difference: z.number().nullable(),
  subcategories: z.array(subcategorySummarySchema),
});

const tagCategorySummarySchema: z.ZodType<TagCategorySummary> = z.object({
  category_id: z.string().nullable(),
  category_name: z.string().nullable(),
  category_type: categoryTypeSchema.nullable(),
  category_color: z.string().nullable(),
  expense_total: z.number(),
  income_total: z.number(),
  net_total: z.number(),
  transaction_count: z.number(),
});

export const tagSummarySchema: z.ZodType<TagSummary> = z.object({
  tag_id: z.string(),
  tag_name: z.string(),
  tag_type: tagTypeSchema,
  tag_color: z.string().nullable(),
  expense_total: z.number(),
  income_total: z.number(),
  net_total: z.number(),
  transaction_count: z.number(),
  categories: z.array(tagCategorySummarySchema),
});

export const dashboardMetricsSchema: z.ZodType<DashboardMetrics> = z.object({
  totalIncome: z.number(),
  totalExpenses: z.number(),
  netChange: z.number(),
});

export const netWorthDataPointSchema: z.ZodType<NetWorthDataPoint> = z
  .object({
    date: z.string(),
    formattedDate: z.string(),
    netWorth: z.number(),
    accountColors: z.record(z.string(), z.string()).optional(),
  })
  .catchall(
    z.union([
      z.string(),
      z.number(),
      z.record(z.string(), z.string()),
      z.undefined(),
    ]),
  );

const sankeyNodeSchema: z.ZodType<SankeyNode> = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  nodeColor: z.string().optional(),
});

const sankeyLinkSchema: z.ZodType<SankeyLink> = z.object({
  source: z.string(),
  target: z.string(),
  value: z.number(),
});

export const sankeyDataSchema: z.ZodType<SankeyData> = z.object({
  nodes: z.array(sankeyNodeSchema),
  links: z.array(sankeyLinkSchema),
});
