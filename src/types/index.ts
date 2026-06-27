// === ENUMS ===
export type AccountType = "asset" | "liability";
export type CategoryType = "income" | "expense";
export type TransactionKind = "income" | "expense" | "transfer" | "adjustment";
export type GoalPeriod = "weekly" | "monthly" | "quarterly" | "annual";

// === CORE ENTITIES ===

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
  color: string | null;
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
  color: string | null;
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
  color: string | null;
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

// === DASHBOARD TYPES ===

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

// === FILTER TYPES ===

export interface TransactionFilters {
  accountId?: string;
  accountIds?: string[];
  categoryIds?: string[];
  subcategoryId?: string;
  subcategoryIds?: string[];
  kind?: TransactionKind;
  needsCategory?: boolean;
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

// === SUSPECT TRANSACTION REVIEW ===

export type SuspectFindingStatus = "open" | "dismissed" | "resolved";
export type SuspectSeverity = "low" | "medium" | "high";
export type SuspectReasonCode =
  | "exact_duplicate"
  | "near_duplicate"
  | "large_amount_outlier"
  | "merchant_amount_outlier"
  | "rapid_small_charge_cluster"
  | "missing_category"
  | "unmatched_transfer_like"
  | "flagged_word";

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
  kind: TransactionKind;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  categorizationSource: "lookup" | "ai" | "none";
  isDuplicate: boolean;
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
  color?: string | null;
}

export interface CreateCategoryData {
  name: string;
  type: CategoryType;
  color?: string | null;
}

export interface CreateSubcategoryData {
  name: string;
  category_id: string;
  monthly_goal?: number | null;
  color?: string | null;
}

export interface CreateTransactionData {
  account_id: string;
  date: string;
  name: string;
  amount: number;
  kind?: TransactionKind;
  subcategory_id?: string | null;
  comment?: string | null;
  ai_suggested?: boolean;
}

export interface ReconcileAccountData {
  date: string;
  target_balance: number;
  name?: string;
}

export interface ReconcileAccountResult {
  transaction: Transaction | null;
  previous_balance: number;
  target_balance: number;
  adjustment_amount: number;
}

export interface CreateSpendingGoalData {
  subcategory_id: string;
  amount: number;
  period: GoalPeriod;
  start_date: string;
  end_date?: string | null;
}
