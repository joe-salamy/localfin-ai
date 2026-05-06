// === ENUMS ===
export type AccountType = 'asset' | 'liability';
export type CategoryType = 'income' | 'expense';
export type GoalPeriod = 'weekly' | 'monthly' | 'quarterly' | 'annual';

// === CORE ENTITIES ===

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AccountWithBalance extends Account {
  current_balance: number;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  is_system: boolean;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface Subcategory {
  id: string;
  category_id: string;
  name: string;
  monthly_goal: number | null;
  is_system: boolean;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  name: string;
  amount: number;
  subcategory_id: string | null;
  comment: string | null;
  is_initial_balance: boolean;
  ai_suggested: boolean;
  user_corrected: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TransactionWithDetails extends Transaction {
  account_name?: string;
  account_type?: string;
  subcategory_name?: string;
  category_id?: string;
  category_name?: string;
  category_type?: string;
  running_balance?: number;
}

export interface SpendingGoal {
  id: string;
  subcategory_id: string;
  amount: number;
  period: GoalPeriod;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SpendingGoalWithDetails extends SpendingGoal {
  subcategory_name: string;
  category_name: string;
  category_type: CategoryType;
}

export interface AICorrection {
  id: string;
  transaction_name: string;
  account_id: string;
  ai_suggested_subcategory_id: string | null;
  user_corrected_subcategory_id: string;
  created_at: string;
}

// === DASHBOARD TYPES ===

export interface AccountSummary {
  account_id: string;
  account_name: string;
  account_type: AccountType;
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
}

export interface CategorySummary {
  category_id: string;
  category_name: string;
  category_type: CategoryType;
  total: number;
  goal: number | null;
  difference: number | null;
  subcategories: SubcategorySummary[];
}

export interface SubcategorySummary {
  subcategory_id: string;
  subcategory_name: string;
  total: number;
  goal: number | null;
  difference: number | null;
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

// === CHART TYPES ===

export interface NetWorthDataPoint {
  date: string;
  formattedDate: string;
  netWorth: number;
  [accountName: string]: string | number;
}

export interface SankeyNode {
  id: string;
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

// === FILTER TYPES ===

export interface TransactionFilters {
  accountId?: string;
  subcategoryId?: string;
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

// === PARSING TYPES ===

export interface ParsedTransaction {
  date: string;
  name: string;
  amount: number;
  needsReview: boolean;
  confidence: number;
  originalLine: string;
}

export interface EnrichedTransaction extends ParsedTransaction {
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  categorizationSource: 'lookup' | 'correction' | 'ai' | 'none';
  isDuplicate: boolean;
  aiConfidence: number;
}

// === AI TYPES ===

export interface TransactionForCategorization {
  name: string;
  account_name: string;
  amount: number;
}

export interface CategorizationResult {
  subcategory_id: string;
  subcategory_name: string;
  category_name: string;
  confidence: number;
}

// === API RESPONSE ===

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// === CREATE/UPDATE TYPES ===

export interface CreateAccountData {
  name: string;
  type: AccountType;
  initial_balance?: number;
}

export interface CreateCategoryData {
  name: string;
  type: CategoryType;
}

export interface CreateSubcategoryData {
  name: string;
  category_id: string;
  monthly_goal?: number | null;
}

export interface CreateTransactionData {
  account_id: string;
  date: string;
  name: string;
  amount: number;
  subcategory_id?: string | null;
  comment?: string | null;
}

export interface CreateSpendingGoalData {
  subcategory_id: string;
  amount: number;
  period: GoalPeriod;
  start_date: string;
  end_date?: string | null;
}
