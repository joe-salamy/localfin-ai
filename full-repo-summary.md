# AI Budget App - Complete Repository Summary

> **Purpose**: This document is a comprehensive summary of the entire `ai-budget-app` repository, intended to serve as the sole reference for rebuilding the application as a fully local, offline-first budget app (no database, no SaaS). Every schema, service, component, API endpoint, business rule, and design decision is documented here.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Data Model & Schemas](#3-data-model--schemas)
4. [Database Schema (SQL)](#4-database-schema-sql)
5. [System Constants & Seed Data](#5-system-constants--seed-data)
6. [Service Layer (Business Logic)](#6-service-layer-business-logic)
7. [API Endpoints (Serverless Functions)](#7-api-endpoints-serverless-functions)
8. [Custom Hooks (State Management)](#8-custom-hooks-state-management)
9. [Pages & Routing](#9-pages--routing)
10. [Components](#10-components)
11. [UI Component Library](#11-ui-component-library)
12. [Utility Functions](#12-utility-functions)
13. [Styling & Design System](#13-styling--design-system)
14. [AI Features](#14-ai-features)
15. [Key Business Rules & Design Decisions](#15-key-business-rules--design-decisions)
16. [Scratchpad & Future Ideas](#16-scratchpad--future-ideas)
17. [Known Issues & Blockers](#17-known-issues--blockers)
18. [Appendix: Full File Tree](#18-appendix-full-file-tree)

---

## 1. Project Overview

A personal finance/budget application built with React + TypeScript. Core features:

- **Account management**: Track bank accounts (assets) and credit cards (liabilities)
- **Transaction tracking**: Manual entry, bulk paste, and statement parsing
- **AI categorization**: Automatically categorize transactions using Google Gemini
- **Budget goals**: Set spending limits per subcategory with period-based tracking
- **Dashboard**: Financial summaries, net worth chart, Sankey cash flow diagram
- **AI chatbot**: Conversational assistant with function calling (can create accounts, add transactions, etc.)
- **Dark mode only**: Black/white minimalist aesthetic (inspired by grok.com, scale.com)

### Architecture Pattern

```
Service (data fetching/mutations)
  -> Hook (React Query + state management)
    -> Component (UI rendering)
```

All data operations go through services. Hooks wrap services with React Query for caching/invalidation. Components consume hooks.

### Response Pattern

All services return a standardized response:

```typescript
{ success: boolean; data?: T; error?: string }
```

---

## 2. Tech Stack

### Dependencies (from package.json)

| Category           | Package                                        | Version  |
| ------------------ | ---------------------------------------------- | -------- |
| **Framework**      | react                                          | ^19.2.0  |
| **Build**          | vite                                           | ^7.2.4   |
| **Language**       | typescript                                     | ~5.9.3   |
| **Styling**        | tailwindcss                                    | ^4.1.18  |
| **Router**         | react-router-dom                               | ^7.12.0  |
| **Data Fetching**  | @tanstack/react-query                          | ^5.62.11 |
| **Database**       | @supabase/supabase-js                          | ^2.90.1  |
| **Charts**         | recharts                                       | ^3.6.0   |
| **Sankey Diagram** | @nivo/sankey                                   | ^0.99.0  |
| **Date Utils**     | date-fns                                       | ^4.1.0   |
| **Animations**     | framer-motion                                  | ^12.26.2 |
| **Icons**          | lucide-react                                   | ^0.562.0 |
| **Markdown**       | react-markdown                                 | ^10.1.0  |
| **Toast**          | sonner                                         | ^2.0.7   |
| **Validation**     | zod                                            | ^4.3.5   |
| **Date Picker**    | react-day-picker                               | ^9.13.0  |
| **UI Primitives**  | @radix-ui/\*                                   | various  |
| **CSS Utils**      | clsx, tailwind-merge, class-variance-authority | various  |
| **Serverless**     | @vercel/node                                   | ^5.0.2   |

### Build Scripts

```json
{
  "dev": "vite",
  "dev:vercel": "vercel dev",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

### TypeScript Config

- `verbatimModuleSyntax: true` (requires `import type` for type-only imports)
- Path alias: `@/*` -> `./src/*`
- ES2022 target, strict mode enabled

### Environment Variables

```
VITE_SUPABASE_URL        # Supabase project URL (client-side)
VITE_SUPABASE_ANON_KEY   # Supabase anonymous key (client-side)
SUPABASE_SERVICE_ROLE_KEY # Supabase service role key (server-side only)
GEMINI_API_KEY            # Google Gemini API key (server-side only)
```

---

## 3. Data Model & Schemas

### TypeScript Types (src/types/index.ts)

```typescript
// === ENUMS ===

type AccountType = "asset" | "liability";
type CategoryType = "income" | "expense";
type GoalPeriod = "weekly" | "monthly" | "quarterly" | "annual";
type AIPersonality = "professional" | "friendly" | "stern";
type ChatRole = "user" | "assistant";

// === CORE ENTITIES ===

interface User {
  id: string;
  email: string;
  created_at: string;
}

interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType; // "asset" (bank account) or "liability" (credit card)
  created_at: string;
  updated_at: string;
  deleted_at: string | null; // Soft delete
}

interface Category {
  id: string;
  user_id: string;
  name: string;
  type: CategoryType; // "income" or "expense"
  is_system: boolean; // True for system "Unassigned" categories
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface Subcategory {
  id: string;
  user_id: string;
  category_id: string; // FK to Category
  name: string;
  monthly_goal: number | null; // Optional budget goal amount
  is_system: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface Transaction {
  id: string;
  user_id: string;
  account_id: string; // FK to Account
  date: string; // YYYY-MM-DD
  name: string; // Merchant/payee description
  amount: number; // Positive = income, Negative = expense
  subcategory_id: string | null; // FK to Subcategory (nullable)
  comment: string | null;
  is_initial_balance: boolean; // True if this is the account's starting balance
  ai_suggested: boolean; // True if AI auto-categorized
  user_corrected: boolean; // True if user overrode AI suggestion
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface SpendingGoal {
  id: string;
  user_id: string;
  subcategory_id: string; // FK to Subcategory
  amount: number; // Budget limit
  period: GoalPeriod; // How often goal resets
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface AICorrection {
  id: string;
  user_id: string;
  transaction_name: string; // Normalized (lowercase, trimmed)
  account_id: string; // FK to Account
  ai_suggested_subcategory_id: string | null;
  user_corrected_subcategory_id: string; // What user chose instead
  created_at: string;
}

interface UserPreferences {
  id: string;
  user_id: string;
  ai_personality: AIPersonality; // Chatbot personality style
  currency: string; // Default: "USD"
  created_at: string;
  updated_at: string;
}

interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

interface ChatMessage {
  id: string;
  session_id: string; // FK to ChatSession
  user_id: string;
  role: ChatRole; // "user" or "assistant"
  content: string;
  function_calls: object | null; // JSON of function call results
  created_at: string;
}
```

### Extended/Derived Types (from services)

```typescript
// Account with computed balance
interface AccountWithBalance extends Account {
  current_balance: number; // Sum of all transactions for this account
}

// Transaction with joined relationship data (flattened)
interface TransactionWithDetails extends Transaction {
  account_name?: string;
  account_type?: string;
  subcategory_name?: string;
  category_id?: string;
  category_name?: string;
  category_type?: string;
  running_balance?: number;
}

// Dashboard types
interface AccountSummary {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  starting_balance: number; // Balance before date range
  total_change: number; // Sum of transactions in range
  ending_balance: number; // starting + change
  transactions: AccountTransaction[];
}

interface AccountTransaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  running_balance: number;
  subcategory_name: string | null;
  category_name: string | null;
}

interface CategorySummary {
  category_id: string;
  category_name: string;
  category_type: CategoryType;
  total: number;
  goal: number | null; // Scaled goal for date range
  difference: number | null; // goal - |total|
  subcategories: SubcategorySummary[];
}

interface SubcategorySummary {
  subcategory_id: string;
  subcategory_name: string;
  total: number;
  goal: number | null;
  difference: number | null;
}

interface NetWorthSummary {
  total_assets: number;
  total_liabilities: number;
  net_worth: number; // assets - liabilities
}

// Chart types
interface NetWorthDataPoint {
  date: string;
  formattedDate: string;
  netWorth: number;
  [accountName: string]: string | number; // Dynamic per-account balances
}

interface SankeyNode {
  id: string;
  nodeColor?: string;
}
interface SankeyLink {
  source: string;
  target: string;
  value: number;
}
interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

// AI types
interface TransactionForCategorization {
  name: string;
  account_name: string;
  amount: number;
}

interface CategorizationResult {
  subcategory_id: string;
  subcategory_name: string;
  category_name: string;
  confidence: number; // 0.0 to 1.0
}

// Spending goal with details
interface SpendingGoalWithDetails extends SpendingGoal {
  subcategory_name: string;
  category_name: string;
  category_type: "income" | "expense";
}

// Transaction filters
interface TransactionFilters {
  accountId?: string;
  subcategoryId?: string;
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

// Statement parsing types
interface ParsedTransaction {
  date: string;
  name: string;
  amount: number;
  needsReview: boolean;
  confidence: number;
  originalLine: string;
}

interface EnrichedTransaction extends ParsedTransaction {
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  categorizationSource: "lookup" | "correction" | "ai" | "none";
  isDuplicate: boolean;
  aiConfidence: number;
}
```

---

## 4. Database Schema (SQL)

### Enums

```sql
CREATE TYPE account_type AS ENUM ('asset', 'liability');
CREATE TYPE category_type AS ENUM ('income', 'expense');
CREATE TYPE goal_period AS ENUM ('weekly', 'monthly', 'quarterly', 'annual');
CREATE TYPE ai_personality AS ENUM ('professional', 'friendly', 'stern');
CREATE TYPE chat_role AS ENUM ('user', 'assistant');
```

### Tables

#### user_preferences

```sql
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_personality ai_personality NOT NULL DEFAULT 'friendly',
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
```

#### accounts

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type account_type NOT NULL,
  -- NOTE: initial_balance column was REMOVED in migration 20260130
  -- Initial balance is now stored as a transaction with is_initial_balance=true
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT unique_account_name_per_user UNIQUE(user_id, name, deleted_at)
);
```

#### categories

```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,  -- NULL for system categories (is_system=true)
  name TEXT NOT NULL,
  type category_type NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT unique_category_name_per_user UNIQUE(user_id, name, deleted_at),
  CONSTRAINT categories_user_id_check CHECK (user_id IS NOT NULL OR is_system = true)
);
```

#### subcategories

```sql
CREATE TABLE subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,  -- NULL for system subcategories
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  monthly_goal DECIMAL(12, 2),  -- Added in migration 20260126
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT unique_subcategory_name_per_user UNIQUE(user_id, name, deleted_at),
  CONSTRAINT subcategories_user_id_check CHECK (user_id IS NOT NULL OR is_system = true)
);
```

#### transactions

```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name TEXT NOT NULL,                -- Merchant/payee description
  amount DECIMAL(12, 2) NOT NULL,    -- Positive=income, Negative=expense
  subcategory_id UUID REFERENCES subcategories(id) ON DELETE SET NULL,
  comment TEXT,
  is_initial_balance BOOLEAN NOT NULL DEFAULT false,
  -- NOTE: is_transfer and transfer_to_account_id were REMOVED in migration 20260202
  ai_suggested BOOLEAN NOT NULL DEFAULT false,
  user_corrected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

#### spending_goals

```sql
CREATE TABLE spending_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subcategory_id UUID NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL,
  period goal_period NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,  -- Added in migration 20260124
  CONSTRAINT positive_goal_amount CHECK (amount > 0)
);
```

#### ai_corrections

```sql
CREATE TABLE ai_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_name TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_suggested_subcategory_id UUID REFERENCES subcategories(id) ON DELETE SET NULL,
  user_corrected_subcategory_id UUID NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### chat_sessions

```sql
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### chat_messages

```sql
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role chat_role NOT NULL,
  content TEXT NOT NULL,
  function_calls JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Key Indexes

```sql
-- Transaction lookup (most critical for performance)
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date DESC);
CREATE INDEX idx_transactions_lookup ON transactions(user_id, account_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE INDEX idx_transactions_subcategory_id ON transactions(subcategory_id);
CREATE INDEX idx_transactions_deleted_at ON transactions(deleted_at) WHERE deleted_at IS NULL;

-- AI corrections lookup
CREATE INDEX idx_ai_corrections_lookup ON ai_corrections(user_id, account_id, transaction_name);

-- Chat ordering
CREATE INDEX idx_chat_sessions_last_message_at ON chat_sessions(last_message_at DESC);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
```

### Triggers

1. **Auto-update `updated_at`**: Fires BEFORE UPDATE on `user_preferences`, `accounts`, `transactions`, `spending_goals`, `chat_sessions`
2. **Auto-create user_preferences**: Fires AFTER INSERT on `auth.users` - automatically creates a `user_preferences` row for new users

### Migration History (Chronological)

| Migration                                    | Description                                                       |
| -------------------------------------------- | ----------------------------------------------------------------- |
| 20260108_initial_schema                      | All tables, indexes, triggers, comments                           |
| 20260108_rls_policies                        | Row-level security (user isolation)                               |
| 20260108_seed_data                           | System "Unassigned" categories/subcategories                      |
| 20260124_add_timestamps                      | Added updated_at to categories/subcategories, deleted_at to goals |
| 20260126_add_monthly_goal_to_subcategories   | Added monthly_goal column to subcategories                        |
| 20260126_migrate_spending_goals_data         | Migrated spending goals data to monthly_goal                      |
| 20260129_create_initial_balance_transactions | Created initial balance transactions for existing accounts        |
| 20260130_remove_initial_balance_column       | Removed initial_balance from accounts table                       |
| 20260202_remove_transfer_columns             | Removed is_transfer and transfer_to_account_id from transactions  |
| 20260202_drop_saving_goals                   | Dropped the saving_goals table entirely                           |
| 20260202_fix_search_path_security            | Fixed security in update_updated_at_column function               |
| 20260202_optimize_rls_policies               | Wrapped auth.uid() in SELECT subquery for performance             |
| 20260202_add_missing_fkey_indexes            | Added indexes on foreign key columns                              |

---

## 5. System Constants & Seed Data

### Hardcoded System UUIDs (src/config/constants.ts)

```typescript
export const SYSTEM_CATEGORIES = {
  INCOME_UNASSIGNED: "00000000-0000-0000-0000-000000000001",
  EXPENSE_UNASSIGNED: "00000000-0000-0000-0000-000000000002",
} as const;

export const SYSTEM_SUBCATEGORIES = {
  INCOME_UNASSIGNED: "00000000-0000-0000-0000-000000000003",
  EXPENSE_UNASSIGNED: "00000000-0000-0000-0000-000000000004",
} as const;
```

### Other Constants

```typescript
export const APP_NAME = "AI Budget App";
export const APP_VERSION = "0.1.0";
export const DATE_FORMAT = "yyyy-MM-dd";
export const DISPLAY_DATE_FORMAT = "MMM d, yyyy";
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_DATE_RANGE_DAYS = 90;
```

### Seed Data

The system creates 4 read-only items available to all users:

1. **Income > Unassigned** category (UUID: ...0001)
2. **Expense > Unassigned** category (UUID: ...0002)
3. **Income > Unassigned** subcategory (UUID: ...0003)
4. **Expense > Unassigned** subcategory (UUID: ...0004)

These have `is_system = true` and `user_id = NULL`. They cannot be edited or deleted. They serve as fallbacks when categorization fails.

---

## 6. Service Layer (Business Logic)

### accounts.ts - Account CRUD

**Functions:**

- `createAccount(data: CreateAccountData)` - Creates account + initial balance transaction (if balance != 0)
- `getAccounts()` - All non-deleted accounts, ordered by created_at
- `getAccountsWithBalances()` - Accounts with computed `current_balance` (sum of all transactions)
- `getAccountById(id)` - Single account lookup
- `updateAccount(id, updates)` - Update name/type
- `deleteAccount(id)` - Soft delete (sets deleted_at)
- `deleteAccountTransactions(accountId)` - Soft delete all transactions for an account
- `getAccountTransactionCount(accountId)` - Count non-deleted transactions

**Key business rule:** Name uniqueness is enforced across accounts, categories, AND subcategories. Creating an account named "Groceries" will fail if a category or subcategory named "Groceries" exists.

**Initial balance:** When creating an account with initial_balance != 0, a special transaction is created:

```typescript
{
  name: `${accountName} - Initial Balance`,
  amount: initial_balance,
  is_initial_balance: true,
  date: account.created_at (date portion)
}
```

### categories.ts - Category & Subcategory CRUD

**Category Functions:**

- `createCategory(data)` - Create with name uniqueness check
- `getCategories()` - All non-deleted, system categories first
- `getCategoryById(id)`
- `updateCategory(id, updates)` - Cannot update system categories
- `deleteCategory(id)` - Cannot delete system categories or categories with subcategories

**Subcategory Functions:**

- `createSubcategory(data: { name, category_id, monthly_goal? })` - With uniqueness check
- `getSubcategories()` - All non-deleted, system first
- `getSubcategoriesByCategory(categoryId)` - Filtered by parent
- `getSubcategoryById(id)`
- `updateSubcategory(id, updates: { name?, category_id?, monthly_goal? })` - Cannot update system
- `deleteSubcategory(id)` - Cannot delete system
- `deleteSubcategoryTransactions(subcategoryId)` - Soft delete related transactions
- `getSubcategoryTransactionCount(subcategoryId)`
- `unassignSubcategoryTransactions(subcategoryId, unassignedId)` - Reassign transactions to "Unassigned"

### transactions.ts - Transaction CRUD & Balance Calculations

**CRUD Functions:**

- `createTransaction(data)` - Always sets `is_initial_balance: false`
- `getTransactions(filters?)` - With optional filtering by account, subcategory, date range, search query
- `getTransactionsWithDetails(filters?)` - Joins with accounts, subcategories, categories (flattened)
- `getTransactionsByAccount(accountId)` - Convenience wrapper
- `getTransactionById(id)`
- `getRecentTransactionByNameAndAccount(name, accountId)` - For lookup-based categorization
- `getRecentActivityByAccount()` - Most recent transaction per account with current balance
- `updateTransaction(id, updates)`
- `bulkUpdateTransactions(ids, updates)` - Bulk subcategory change
- `deleteTransaction(id)` - Soft delete
- `bulkDeleteTransactions(ids)` - Bulk soft delete

**Balance Functions:**

- `calculateRunningBalance(accountId, upToDate)` - Sum of transactions up to date
- `calculateCurrentBalance(accountId)` - Sum of all transactions
- `getTransactionsWithRunningBalance(accountId, filters?)` - Each transaction includes running_balance

**Balance calculation:** Account balance = SUM(all transaction amounts for that account). There is no separate balance column. The initial balance is simply a transaction with `is_initial_balance: true`.

**Sort order:** Transactions are ordered by `date DESC, created_at DESC` by default.

### dashboard.ts - Dashboard Summaries

**Functions:**

- `getAccountSummary(startDate, endDate)` - Per-account: starting balance (pre-range), total change, ending balance, detailed transactions with running balances. Also returns net worth.
- `getCategorySummary(startDate, endDate)` - Per-category/subcategory: total spent/earned, scaled goals, difference (goal - |total|). Flags uncategorized transactions.
- `calculateNetWorth(atDate)` - Total assets - total liabilities at a specific date
- `getDashboardMetrics(startDate, endDate)` - Quick totals: totalIncome, totalExpenses, netChange

**Goal scaling logic:** Goals are scaled to match the dashboard date range:

```
scaledGoal = (goal.amount / periodDays) * rangeInDays

periodDays: weekly=7, monthly=30.42, quarterly=91.25, annual=365
```

**Income vs Expense determination:** Uses amount sign:

- `amount > 0` = income
- `amount < 0` = expense

### charts.ts - Chart Data Preparation

**Functions:**

- `prepareNetWorthData(startDate, endDate)` - Net worth line chart data with per-account breakdown. Granularity: <28 days = daily, <180 days = weekly, >=180 days = monthly.
- `prepareSankeyData(startDate, endDate)` - Cash flow Sankey diagram. Flow: Income Subcategories -> Income Categories -> Total Income -> Total Expenses -> Expense Categories -> Expense Subcategories. Includes "Savings" node if income > expenses.

**Sankey node colors:**

- Income subcategories: `#003804` (dark green)
- Income categories: `#334f35` (green-gray)
- Center nodes (Total Income/Expenses): `#676767` (gray)
- Expense categories: `#6b3434` (red-gray)
- Expense subcategories: `#6f0000` (dark red)
- Savings: `#090088` (blue)

### goals.ts - Spending Goals

**Functions:**

- `createSpendingGoal(data)` - One goal per subcategory (enforced)
- `getSpendingGoals()` - All goals, newest first
- `getSpendingGoalsWithDetails()` - With subcategory/category names
- `getSpendingGoalById(id)`
- `updateSpendingGoal(id, updates)`
- `deleteSpendingGoal(id)` - Soft delete
- `getSpendingProgress(goalId, referenceDate?)` - Calculates spent, remaining, percentUsed for the current period

**Period boundary calculation:**

- Weekly: Sunday to Saturday
- Monthly: 1st to last day of month
- Quarterly: Standard quarters (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec)
- Annual: Jan 1 to Dec 31

### ai.ts - AI Categorization Client

**Functions:**

- `categorizeSingleTransaction(transaction)` - Calls `/api/categorize` with mode="single"
- `categorizeBatchTransactions(transactions[])` - Calls `/api/categorize` with mode="batch"
- `saveAICorrection(data)` - Upserts correction (normalized name + account -> subcategory)
- `getAICorrection(transactionName, accountId)` - Lookup user's preferred categorization

**Correction normalization:** Transaction names are `.trim().toLowerCase()` before storage/lookup.

### chat.ts - Chat Service Client

**Functions:**

- `sendMessage(message, sessionId?, currentPage?)` - Calls `/api/chat`
- `getSessions()` - All sessions, most recent first
- `getSessionMessages(sessionId)` - Messages in chronological order
- `createSession(title?)` - Default title: "New Chat"
- `deleteSession(sessionId)` - Deletes messages then session
- `renameSession(sessionId, newTitle)`
- `getAIPersonality()` - From user_preferences (default: "friendly")
- `updateAIPersonality(personality)`

### auth.ts - Authentication

**Functions:**

- `signUp(email, password)` - Email/password registration
- `signIn(email, password)` - Email/password login
- `signInWithGoogle()` - OAuth redirect
- `signOut()` - Logout
- `resetPassword(email)` - Password reset email

---

## 7. API Endpoints (Serverless Functions)

### POST /api/categorize - AI Transaction Categorization

**Model:** Google Gemini 1.5 Flash (temperature: 0.1 for consistency)

**Modes:**

- `single`: Categorize one transaction
- `batch`: Categorize up to 50 transactions

**Request body:**

```typescript
{
  mode: "single" | "batch",
  transaction?: { name, account_name, amount },    // single mode
  transactions?: { name, account_name, amount }[],  // batch mode
  access_token: string
}
```

**Process:**

1. Fetch user's subcategories with category info
2. Fetch last 100 past categorized transactions (for context)
3. Fetch user's AI corrections (highest priority)
4. Build prompt with all context
5. Call Gemini API for JSON response
6. Validate results (fallback to "Unassigned" if invalid)

**Prompt structure:**

- Available subcategories (grouped by income/expense)
- Past categorization examples (up to 50)
- User corrections (MUST follow these)
- Transactions to categorize
- Instructions about amount sign -> category type mapping

**Confidence levels:**

- 1.0: Exact match to user correction
- 0.9+: Close match to past transaction
- 0.7-0.9: Reasonable name-based match
- 0.5-0.7: Less certain
- 0.3-0.5: Guess
- 0: Fallback to Unassigned

### POST /api/chat - AI Chatbot

**Model:** Google Gemini 2.0 Flash (temperature: 0.7)

**Request body:**

```typescript
{
  message: string,
  session_id?: string,     // Creates new session if omitted
  current_page?: string,   // Page context for AI
  access_token: string
}
```

**Process:**

1. Verify auth, fetch user context (accounts, categories, subcategories, recent transactions, preferences, monthly totals)
2. Get/create chat session
3. Fetch last 20 messages for history
4. Build system prompt with personality + financial context
5. Call Gemini with function calling enabled
6. Execute any function calls
7. Save user message + assistant response to database
8. Return response with function call results

**Available functions (8 total):**

| Function                     | Description                 | Parameters                                                             |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `create_account`             | Create financial account    | name, type, initial_balance                                            |
| `create_category`            | Create transaction category | name, type                                                             |
| `create_subcategory`         | Create subcategory          | name, category_name                                                    |
| `add_transaction`            | Add a transaction           | date, name, amount, account_name, subcategory_name?                    |
| `get_spending_summary`       | Spending for a period       | period (this_month, last_month, last_30_days, last_90_days, this_year) |
| `get_account_balance`        | Account balance(s)          | account_name? (all if omitted)                                         |
| `create_spending_goal`       | Create budget goal          | subcategory_name, amount, period                                       |
| `get_spending_goals_summary` | All goals summary           | (none)                                                                 |

**Personality prompts:**

- **Professional:** "Be clear, concise, and formal. Focus on accurate financial guidance."
- **Friendly:** "Be warm, encouraging, and supportive. Use casual language."
- **Stern:** "Be direct and hold the user accountable. Don't sugarcoat."

### POST /api/parse-statement - Statement Parsing

**Process (7 steps):**

1. **Parse with regex** - Tries multiple format patterns (credit card standard, Chase credit, CSV, tab-separated, fallback)
2. **Check duplicates** - Compares against existing transactions by date+name+amount
3. **Fetch subcategories** - For categorization
4. **Lookup corrections** - Check ai_corrections table
5. **Lookup past transactions** - Check for same transaction name in history
6. **Enrich** - Apply categorization from corrections > lookup > mark for AI
7. **Parallel AI batch categorization** - Send uncategorized in batches of 10 to Gemini

**Three-tier categorization priority:**

1. AI corrections (user has manually corrected this before)
2. Past transaction lookup (same name was categorized before)
3. AI categorization (Gemini)

**Date patterns supported:**

- MM/DD/YYYY, MM/DD/YY, MM/DD (assumes current year)
- YYYY-MM-DD, DD-MM-YYYY
- Mon DD, YYYY (e.g., "Jan 15, 2026")

**Amount parsing:**

- Handles: `$`, parentheses for negative, `-` prefix/suffix, `DR`/`CR` suffix
- Removes commas and currency symbols

**Transaction name cleaning:**

- Collapses whitespace
- Removes prefixes: POS, ACH, CHECK, DEBIT, CREDIT, PURCHASE
- Removes trailing reference numbers (6+ digits)

**Response:**

```typescript
{
  success: boolean,
  transactions: EnrichedTransaction[],
  summary: {
    total, duplicates, fromLookup, fromCorrection, fromAI, uncategorized, needsReview
  },
  format: string | null,
  parseSuccessRate: number,
  errors: string[]
}
```

**Limits:** Max 500 transactions per request, max 500KB statement text.

---

## 8. Custom Hooks (State Management)

### useAuth.tsx - Authentication Context

Provides `AuthProvider` component and `useAuth()` hook.

**State:** `user`, `loading`

**Methods:** `login(email, password)`, `signup(email, password)`, `loginWithGoogle()`, `logout()`, `resetPassword(email)`

**Behavior:** Listens to `supabase.auth.onAuthStateChange` for session changes.

### useAccounts.ts - Account Management

Uses React Query for caching.

**Queries:**

- `accountsQuery` - All accounts with balances (key: `["accounts", "list"]`)

**Mutations:**

- `createAccount` - Invalidates accounts + dashboard
- `updateAccount` - Invalidates accounts + dashboard
- `deleteAccount` - Invalidates accounts + transactions + dashboard

### useCategories.ts - Category Management

**Queries:**

- `categoriesQuery` - All categories (key: `["categories", "list"]`)
- `subcategoriesQuery` - All subcategories (key: `["subcategories", "list"]`)

**Mutations:**

- `createCategory`, `updateCategory`, `deleteCategory`
- `createSubcategory`, `updateSubcategory`, `deleteSubcategory`

All mutations invalidate categories, subcategories, and dashboard queries.

### useTransactions.ts - Transaction Management

**Queries:**

- `transactionsQuery(filters)` - Transactions with details
- `recentActivityQuery` - Recent activity by account

**Mutations:**

- `createTransaction` - Invalidates transactions + accounts + dashboard
- `updateTransaction` - Same invalidation
- `bulkUpdateTransactions` - Same
- `deleteTransaction` - Same
- `bulkDeleteTransactions` - Same

Also exports `useRecentActivity()` and `useSimpleTransactions()` hooks.

### useDashboard.ts - Dashboard Data

**Queries (all parameterized by startDate/endDate):**

- `accountSummaryQuery(startDate, endDate)`
- `categorySummaryQuery(startDate, endDate)`
- `metricsQuery(startDate, endDate)`
- `netWorthChartQuery(startDate, endDate)`
- `sankeyChartQuery(startDate, endDate)`

### useChatPanel.tsx - Chat Panel State

Provides `ChatPanelProvider` and `useChatPanel()` hook.

**State:** `isOpen`, `sessions`, `currentSessionId`, `messages`, `isLoading`, `isSending`

**Methods:** `togglePanel()`, `sendMessage(message)`, `selectSession(id)`, `createNewSession()`, `deleteSession(id)`, `renameSession(id, title)`, `quickActions[]`

**Quick actions:** Pre-defined prompts like "What's my spending summary?" etc.

### useAutoSave.ts - Debounced Auto-save

```typescript
useAutoSave(value: T, onSave: (value: T) => void, delay?: number)
```

Debounces save operations, skips first render.

### usePrefetchOtherPages.ts - Data Prefetching

Prefetches data for pages the user hasn't visited yet to improve navigation speed.

---

## 9. Pages & Routing

### Route Configuration (src/Router.tsx)

```
/              -> LandingPage (public, redirects to /dashboard if logged in)
/login         -> LoginPage (public, redirects to /dashboard if logged in)
/signup        -> SignUpPage (public, redirects to /dashboard if logged in)
/dashboard     -> DashboardPage (protected)
/setup         -> SetupPage (protected)
/transactions/input   -> TransactionInputPage (protected)
/transactions/history -> TransactionHistoryPage (protected)
/settings      -> SettingsPage (protected)
*              -> Redirect to /
```

Protected routes are wrapped in `ChatPanelProvider` and `AppLayout` (shared layout with Navbar + ChatSidePanel).

### Page Descriptions

**LandingPage** - Marketing page with hero section, features grid, CTAs. Animated with Framer Motion.

**LoginPage** - Email/password form + Google OAuth + "Forgot Password" link. Validates email format.

**SignUpPage** - Email/password form + Google OAuth. Password confirmation.

**SetupPage** - Setup wizard (~975 lines). Three-section form:

1. Accounts (add name + type + initial balance)
2. Categories (add name + type: income/expense)
3. Subcategories (add name + parent category + optional monthly goal)
   Each section has add/edit/delete inline. "Skip" option available.

**DashboardPage** - Main dashboard with:

- Date range picker (default: last 90 days)
- Metrics cards: Total Income, Total Expenses, Net Change
- Account Summary table (expandable, shows per-account transactions with running balance)
- Category Summary table (expandable, shows subcategory breakdown with goals)
- Net Worth Chart (Recharts line chart with per-account lines)
- Sankey Diagram (Nivo Sankey showing cash flow)

**TransactionInputPage** - Multi-transaction spreadsheet-style input:

- Paste from clipboard (tab/newline delimited)
- Per-row: date, name, amount, account, subcategory, comment
- AI categorization button (single or batch)
- Categorization indicator shows source (lookup, correction, AI, manual)

**TransactionHistoryPage** - Full transaction table with:

- Date range filter, account filter, search
- Sortable columns
- Row selection (checkbox)
- Bulk edit (change subcategory for selected)
- Bulk delete
- Individual edit/delete

**SettingsPage** - User settings:

- Change password
- AI personality selector (professional/friendly/stern)
- Account actions (manage accounts/categories)

---

## 10. Components

### Layout Components

**AppLayout.tsx** - Main layout wrapper. Uses `<Outlet>` for nested routes. Includes Navbar and ChatSidePanel. Handles Ctrl+K keyboard shortcut to toggle chat.

**Navbar.tsx** - Top navigation bar with logo, nav links (Dashboard, Add Transactions, History), AI assistant button (with keyboard hint), UserProfileMenu.

**MobileMenu.tsx** - Mobile slide-out menu with focus trap and backdrop.

**UserProfileMenu.tsx** - Dropdown showing user email, Settings link, Sign Out button.

### Feature Components

**AccountForm.tsx** - Add/edit account form (name, type, initial balance).

**AccountSummary.tsx** - Expandable table. Each row = account with starting balance, change, ending balance. Expand to see individual transactions with running balance.

**BulkEditModal.tsx** - Modal for selecting a new subcategory to apply to multiple selected transactions.

**CategoryForm.tsx** - Add/edit category form (name, type).

**CategorySummary.tsx** - Expandable table. Each row = category with total, goal, difference. Expand to see subcategory breakdown.

**ChatSessionList.tsx** - Dropdown for selecting chat sessions. Supports rename and delete.

**ChatSidePanel.tsx** - Resizable side panel for AI chat. Features:

- Session management (create, switch, rename, delete)
- Message display with markdown rendering
- Quick action buttons
- Draggable resize handle (min 320px, max 50% screen)
- Close with Escape key

**ConfirmDeleteModal.tsx** - Reusable delete confirmation dialog. Shows item name, optional warning message, transaction count.

**MultiTransactionTable.tsx** - Spreadsheet-style bulk transaction input. Features:

- Dynamic row management (add/remove)
- Paste from clipboard (tab-delimited, auto-parses into rows)
- Per-row AI categorization with confidence indicator
- Batch "Categorize All" button
- Date formatting (auto-slashes)
- Amount formatting (commas)
- Color-coded categorization source indicators

**NetWorthChart.tsx** - Recharts line chart. Shows net worth over time with individual account lines. Automatic granularity (daily/weekly/monthly). Custom tooltip.

**RecentActivityPanel.tsx** - Table showing one row per account: account name, type, current balance, most recent transaction date/name/amount.

**SankeyDiagram.tsx** - Nivo Sankey cash flow visualization. Shows money flow from income sources through to expense categories. Includes savings node if income > expenses.

**SubcategoryForm.tsx** - Add/edit subcategory form (name, parent category, monthly goal).

**TransactionForm.tsx** - Single transaction form with:

- AI categorization (3-tier: correction lookup -> past transaction lookup -> AI call)
- Visual categorization source indicator
- Date picker, account select, subcategory select

**TransactionTable.tsx** - Sortable table with:

- Column sorting (date, name, amount, subcategory, account)
- Row selection (individual + select all)
- Running balance display
- Edit/delete actions per row
- Responsive layout

---

## 11. UI Component Library

All custom UI components in `src/components/ui/`:

| Component               | Description                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Button.tsx**          | Variants: primary, secondary, ghost, danger, outline. Sizes: sm, md, lg. Loading spinner state.                    |
| **Input.tsx**           | Text input with label, error, helper text. Special modes: number (comma formatting), date (auto-slash formatting). |
| **Card.tsx**            | Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter                                              |
| **Modal.tsx**           | Wrapper around Radix Dialog. Sizes: sm, md, lg, xl                                                                 |
| **Select.tsx**          | Radix Select with shadcn styling                                                                                   |
| **SimpleSelect.tsx**    | Native HTML select wrapper for simpler use cases                                                                   |
| **MultiSelect.tsx**     | Dropdown with checkboxes for multiple selection                                                                    |
| **DatePicker.tsx**      | Single date picker using react-day-picker v9                                                                       |
| **DateRangePicker.tsx** | Date range picker with manual text input + calendar popup                                                          |
| **Calendar.tsx**        | Calendar component (react-day-picker v9)                                                                           |
| **Popover.tsx**         | Radix Popover                                                                                                      |
| **avatar.tsx**          | Radix Avatar                                                                                                       |
| **tooltip.tsx**         | Radix Tooltip                                                                                                      |
| **dropdown-menu.tsx**   | Radix Dropdown Menu                                                                                                |
| **dialog.tsx**          | Radix Dialog primitives                                                                                            |

---

## 12. Utility Functions

### src/lib/utils.ts

```typescript
// Tailwind class merging (clsx + tailwind-merge)
function cn(...inputs: ClassValue[]): string;

// Format number with commas: 1234567.89 -> "1,234,567.89"
function formatNumberWithCommas(value: string | number): string;

// Remove commas: "1,234,567.89" -> "1234567.89"
function parseNumberWithCommas(value: string): string;

// Auto-insert slashes in date input: "01012026" -> "01/01/2026"
function formatDateInput(value: string): string;

// Remove slashes from date: "01/01/2026" -> "01012026"
function parseDateInput(value: string): string;
```

### src/lib/queryClient.ts

React Query client configuration with default cache times and refetch behavior.

### src/lib/queryKeys.ts

Centralized query key factory:

```typescript
queryKeys.accounts.list()
queryKeys.categories.list()
queryKeys.categories.subcategories.list()
queryKeys.transactions.list(filters?)
queryKeys.transactions.recentActivity()
queryKeys.goals.spending.list()
queryKeys.dashboard.accountSummary(startDate, endDate)
queryKeys.dashboard.categorySummary(startDate, endDate)
queryKeys.dashboard.metrics(startDate, endDate)
queryKeys.dashboard.charts.netWorth(startDate, endDate)
queryKeys.dashboard.charts.sankey(startDate, endDate)
```

### src/lib/supabaseClient.ts

Supabase client initialization with:

- `autoRefreshToken: true`
- `persistSession: true`
- `detectSessionInUrl: true` (for OAuth)
- Helper functions: `isAuthenticated()`, `getCurrentUser()`, `signOut()`
- Full `Database` type definition for all tables (Row, Insert, Update types)

---

## 13. Styling & Design System

### Design Philosophy

- **Dark mode only** - No light mode
- **Black/white aesthetic** - Inspired by grok.com and scale.com
- **No color gradients** - Pure black/white with grayscale
- **Minimal color** - Color only for semantic meaning (green=income, red=expense, blue=savings)

### CSS Architecture (src/index.css)

Uses Tailwind CSS v4 with `@theme` directive for CSS variables:

```css
/* Key theme variables */
--background: oklch(0.145 0 0); /* Near-black */
--foreground: oklch(0.985 0 0); /* Near-white */
--card: oklch(0.205 0 0); /* Dark gray */
--border: oklch(0.3 0 0); /* Medium gray */
--primary: oklch(0.985 0 0); /* White */
--muted: oklch(0.269 0 0); /* Muted gray */
--destructive: oklch(0.396 0.141 25.723); /* Red */
```

### Tailwind Config

Content scanning: `./index.html`, `./src/**/*.{js,ts,jsx,tsx}`

---

## 14. AI Features

### Transaction Categorization (3-Tier System)

1. **Correction Lookup** (highest priority): Check `ai_corrections` table for this transaction name + account combination. If found, use the user's corrected subcategory. Confidence: 1.0
2. **Past Transaction Lookup**: Check past transactions with the same name in the same account. If found, reuse the same subcategory. Confidence: 0.95
3. **AI Categorization**: Call Gemini API with user's categories, past examples, and corrections as context. Confidence: varies (0.3-0.9+)

### AI Learning System

When a user corrects an AI suggestion:

1. Save correction to `ai_corrections` table (normalized name + account -> subcategory mapping)
2. Future categorizations check corrections first
3. Corrections are also included in AI prompts for pattern learning

### Statement Parsing

Multi-format regex parser with AI fallback:

- Regex patterns detect format automatically
- Known transactions categorized via lookup
- Unknown transactions sent to AI in parallel batches of 10
- Duplicate detection against existing transactions

### AI Chatbot

- Gemini 2.0 Flash with function calling
- Full financial context in system prompt (accounts, balances, recent transactions, monthly totals)
- Can create accounts, categories, subcategories, transactions, and goals
- Can query spending summaries and account balances
- 3 personality modes (professional, friendly, stern)
- Session-based conversation history (last 20 messages)

---

## 15. Key Business Rules & Design Decisions

### Simplifications Made (from scratchpad "What I learned")

1. **No transaction type field** - Removed income/expense type from transactions. Amount sign determines direction: positive = income, negative = expense.
2. **No transfers** - Removed transfer concept entirely. Users add transactions normally; the AI handles it.
3. **Initial balance = transaction** - Account initial balance is stored as a regular transaction with `is_initial_balance: true`, not a column on the accounts table.
4. **No saving_goals table** - Dropped entirely (migration 20260202).

### Name Uniqueness

Names must be unique across accounts, categories, AND subcategories for the same user. This prevents ambiguity in the AI chatbot (e.g., "add transaction to Groceries" - is that an account or subcategory?).

### Soft Deletes

All major entities use soft deletes (`deleted_at` timestamp). Queries filter with `.is("deleted_at", null)`.

### System Categories

System "Unassigned" categories/subcategories:

- Have `user_id = NULL` and `is_system = true`
- Cannot be edited or deleted
- Serve as fallback for uncategorized transactions
- Have hardcoded UUIDs for consistency

### Amount Convention

- **Positive amounts** = income/deposits/credits
- **Negative amounts** = expenses/withdrawals/debits
- Account balance = SUM(all transaction amounts)
- For liability accounts (credit cards), payments are positive, charges are negative

### Date Handling

- Stored as `DATE` in PostgreSQL (YYYY-MM-DD)
- Displayed as `MMM d, yyyy` (e.g., "Jan 15, 2026")
- Input format: MM/DD/YYYY with auto-slash insertion
- Default date range: last 90 days

---

## 16. Scratchpad & Future Ideas

### From docs/scratchpad.md

**Statement Parsing Improvements:**

- Consider all-LLM approach for parsing (regex has edge cases like "eligible for pay over time" flags)
- Or: LLM first pass -> regex cleanup -> existing transaction lookup -> LLM categorization

**AI Agent Design:**

- Consider LangGraph for multi-step agent workflows
- Task queue for handling multiple concurrent AI actions
- System instructions for recurring patterns ("for this transaction, always categorize as X")

**UI/UX Ideas:**

- Account icons (selectable from ~10,000 options)
- Diagram full-screen/detailed view
- Data export as CSV
- Warning for leaving page with unsaved transactions
- Save unsent transactions to local storage
- Page navigation keyboard shortcuts

**Setup Wizard:**

- Post-signup wizard with checkboxes for default items
- "Skip + start blank" or "Skip + start with all defaults"

**Performance:**

- Smarter data loading: going from 365 -> 90 -> 30 days should filter cached data, not refetch
- Reduce delay between load states

**Privacy:**

- Encrypted database for multi-user scenario
- Users should feel secure about data privacy

**Security Checklist:**

- Rate limits
- Row Level Security
- CAPTCHA on auth + forms
- Server-side validation
- API keys secured
- Env vars set properly
- CORS restrictions
- Dependency audit

**Production Checklist:**

- Privacy Policy
- Terms of Service
- Delete Account functionality
- Support pages & FAQ

### Future Feature Ideas (from plan.md)

- Multi-currency support
- CSV import/export
- PDF statement parsing
- Recurring transactions
- Multi-user/household support
- Bank account linking (Plaid)
- Mobile app
- MCP server integration
- Advanced analytics
- Investment tracking
- Tax preparation
- Bill reminders
- Financial projections

---

## 17. Known Issues & Blockers

- **Google OAuth**: Needs dashboard configuration for production
- **Account deletion**: Requires serverless function (can't cascade properly from client)
- **Bundle size**: 1.2MB warning
- **Running balance**: Doesn't calculate properly in some edge cases
- **react-day-picker v9**: Changed classNames API from v8, caused issues during development

---

## 18. Appendix: Full File Tree

```
ai-budget-app/
├── api/
│   ├── categorize.ts              # AI transaction categorization endpoint
│   ├── chat.ts                    # AI chatbot with function calling
│   └── parse-statement.ts         # Statement parsing with regex + AI
├── docs/
│   ├── plan.md                    # 12-phase development plan (~90KB)
│   ├── repo-explained.md          # Detailed architecture guide (~55KB)
│   ├── scratchpad.md              # Working notes and TODOs
│   ├── SUPABASE_SETUP.md          # Database setup instructions
│   ├── verify-setup.md            # Setup verification checklist
│   └── full-repo-summary.md       # THIS FILE
├── src/
│   ├── App.tsx                    # Root app with providers
│   ├── Router.tsx                 # Route configuration
│   ├── main.tsx                   # Entry point
│   ├── index.css                  # Global styles + Tailwind theme
│   ├── components/
│   │   ├── AppLayout.tsx          # Main layout with Navbar + Chat
│   │   ├── features/
│   │   │   ├── AccountForm.tsx
│   │   │   ├── AccountSummary.tsx
│   │   │   ├── BulkEditModal.tsx
│   │   │   ├── CategoryForm.tsx
│   │   │   ├── CategorySummary.tsx
│   │   │   ├── ChatSessionList.tsx
│   │   │   ├── ChatSidePanel.tsx
│   │   │   ├── ConfirmDeleteModal.tsx
│   │   │   ├── MultiTransactionTable.tsx
│   │   │   ├── NetWorthChart.tsx
│   │   │   ├── RecentActivityPanel.tsx
│   │   │   ├── SankeyDiagram.tsx
│   │   │   ├── SubcategoryForm.tsx
│   │   │   ├── TransactionForm.tsx
│   │   │   └── TransactionTable.tsx
│   │   ├── layout/
│   │   │   ├── MobileMenu.tsx
│   │   │   ├── Navbar.tsx
│   │   │   └── UserProfileMenu.tsx
│   │   └── ui/
│   │       ├── avatar.tsx
│   │       ├── Button.tsx
│   │       ├── Calendar.tsx
│   │       ├── Card.tsx
│   │       ├── DatePicker.tsx
│   │       ├── DateRangePicker.tsx
│   │       ├── dialog.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── Input.tsx
│   │       ├── Modal.tsx
│   │       ├── MultiSelect.tsx
│   │       ├── Popover.tsx
│   │       ├── Select.tsx
│   │       ├── SimpleSelect.tsx
│   │       └── tooltip.tsx
│   ├── config/
│   │   └── constants.ts           # App constants + system UUIDs
│   ├── hooks/
│   │   ├── useAccounts.ts
│   │   ├── useAuth.tsx
│   │   ├── useAutoSave.ts
│   │   ├── useCategories.ts
│   │   ├── useChatPanel.tsx
│   │   ├── useDashboard.ts
│   │   ├── usePrefetchOtherPages.ts
│   │   └── useTransactions.ts
│   ├── lib/
│   │   ├── queryClient.ts         # React Query config
│   │   ├── queryKeys.ts           # Centralized query keys
│   │   ├── supabaseClient.ts      # Supabase client + Database types
│   │   └── utils.ts               # cn(), formatNumber, formatDate
│   ├── pages/
│   │   ├── DashboardPage.tsx
│   │   ├── LandingPage.tsx
│   │   ├── LoginPage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── SetupPage.tsx
│   │   ├── SignUpPage.tsx
│   │   ├── TransactionHistoryPage.tsx
│   │   └── TransactionInputPage.tsx
│   ├── services/
│   │   ├── accounts.ts
│   │   ├── ai.ts
│   │   ├── auth.ts
│   │   ├── categories.ts
│   │   ├── charts.ts
│   │   ├── chat.ts
│   │   ├── dashboard.ts
│   │   ├── goals.ts
│   │   └── transactions.ts
│   └── types/
│       └── index.ts               # All TypeScript interfaces/types
├── supabase/
│   └── migrations/
│       ├── 20260108_initial_schema.sql
│       ├── 20260108_rls_policies.sql
│       ├── 20260108_seed_data.sql
│       ├── 20260124_add_timestamps.sql
│       ├── 20260126_add_monthly_goal_to_subcategories.sql
│       ├── 20260126_migrate_spending_goals_data.sql
│       ├── 20260129_create_initial_balance_transactions.sql
│       ├── 20260130_remove_initial_balance_column.sql
│       ├── 20260202_add_missing_fkey_indexes.sql
│       ├── 20260202_drop_saving_goals.sql
│       ├── 20260202_fix_search_path_security.sql
│       ├── 20260202_optimize_rls_policies.sql
│       └── 20260202_remove_transfer_columns.sql
├── CLAUDE.md                       # AI agent instructions
├── package.json
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── eslint.config.js
├── vercel.json
├── index.html
└── progress.md                     # Development progress tracking
```
