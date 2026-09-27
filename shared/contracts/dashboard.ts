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
  /** Balance per account, keyed by account name. */
  balances: Record<string, number>;
}

export interface NetWorthChart {
  points: NetWorthDataPoint[];
  /** Display color per account, keyed by account name. */
  accountColors: Record<string, string>;
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

