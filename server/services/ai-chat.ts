import crypto from 'node:crypto';
import { callOpenRouter, appendConversationLog } from '../ai/openrouter.js';
import { AI_MODELS } from '../config/ai-models.js';
import { createAccount, getAccounts, updateAccount } from './accounts.js';
import {
  createCategory,
  createSubcategory,
  getCategories,
  getSubcategories,
  updateCategory,
  updateSubcategory,
} from './categories.js';
import { createSpendingGoal, getSpendingGoalsWithDetails, updateSpendingGoal } from './goals.js';
import {
  createTransaction,
  getTransactionsWithDetails,
  updateTransaction,
} from './transactions.js';
import type {
  Account,
  AccountType,
  Category,
  CategoryType,
  CreateTransactionData,
  GoalPeriod,
  SpendingGoalWithDetails,
  Subcategory,
} from '../../src/types/index.js';

interface ChatRequest {
  conversationId: string;
  message: string;
  currentPage?: string;
}

interface AIAction {
  type: string;
  input: Record<string, unknown>;
}

interface AIChatResponse {
  message: string;
  actions?: AIAction[];
}

interface ExecutedAction {
  type: string;
  input: Record<string, unknown>;
  status: 'success' | 'error';
  result?: unknown;
  error?: string;
}

export interface ChatResult {
  conversationId: string;
  requestId: string;
  message: string;
  actions: ExecutedAction[];
  logFile: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return asString(value);
}

function hasField(input: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function hasAnyField(input: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => hasField(input, field));
}

function requireAccountType(value: unknown, actionType: string): AccountType {
  if (value === 'asset' || value === 'liability') return value;
  throw new Error(`${actionType} requires type asset|liability`);
}

function optionalAccountType(value: unknown, actionType: string): AccountType | undefined {
  if (value === undefined) return undefined;
  return requireAccountType(value, actionType);
}

function requireCategoryType(value: unknown, actionType: string): CategoryType {
  if (value === 'income' || value === 'expense') return value;
  throw new Error(`${actionType} requires type income|expense`);
}

function optionalCategoryType(value: unknown, actionType: string): CategoryType | undefined {
  if (value === undefined) return undefined;
  return requireCategoryType(value, actionType);
}

function requireGoalPeriod(value: unknown, actionType: string): GoalPeriod {
  if (value === 'weekly' || value === 'monthly' || value === 'quarterly' || value === 'annual') {
    return value;
  }
  throw new Error(`${actionType} requires period weekly|monthly|quarterly|annual`);
}

function optionalGoalPeriod(value: unknown, actionType: string): GoalPeriod | undefined {
  if (value === undefined) return undefined;
  return requireGoalPeriod(value, actionType);
}

function requirePositiveNumber(value: unknown, field: string, actionType: string): number {
  const numberValue = asNumber(value);
  if (numberValue === undefined || numberValue <= 0) {
    throw new Error(`${actionType} requires positive ${field}`);
  }
  return numberValue;
}

function optionalPositiveNumber(value: unknown, field: string, actionType: string): number | undefined {
  if (value === undefined) return undefined;
  return requirePositiveNumber(value, field, actionType);
}

function optionalNonnegativeNumber(value: unknown, field: string, actionType: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const numberValue = asNumber(value);
  if (numberValue === undefined || numberValue < 0) {
    throw new Error(`${actionType} requires nonnegative ${field}`);
  }
  return numberValue;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requireIsoDate(value: unknown, field: string, actionType: string): string {
  const date = asString(value);
  if (!date || !isIsoDate(date)) {
    throw new Error(`${actionType} requires ${field} in YYYY-MM-DD format`);
  }
  return date;
}

function optionalIsoDate(value: unknown, field: string, actionType: string): string | undefined {
  if (value === undefined) return undefined;
  return requireIsoDate(value, field, actionType);
}

function optionalNullableIsoDate(value: unknown, field: string, actionType: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireIsoDate(value, field, actionType);
}

function assertDateRange(startDate: string, endDate: string | null | undefined, actionType: string): void {
  if (endDate && startDate > endDate) {
    throw new Error(`${actionType} requires start_date on or before end_date`);
  }
}

function findByName<T extends { name: string }>(items: T[], name?: string): T | undefined {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === normalized);
}

function resolveAccount(input: Record<string, unknown>, accounts: Account[]): string | undefined {
  return asString(input.account_id) ?? findByName(accounts, asString(input.account_name) ?? asString(input.current_name))?.id;
}

function resolveCategory(input: Record<string, unknown>, categories: Category[]): string | undefined {
  return asString(input.category_id) ?? findByName(categories, asString(input.category_name))?.id;
}

function resolveSubcategory(input: Record<string, unknown>, subcategories: Subcategory[]): string | undefined {
  return asString(input.subcategory_id) ?? findByName(subcategories, asString(input.subcategory_name) ?? asString(input.current_name))?.id;
}

function resolveRequestedCategory(input: Record<string, unknown>, categories: Category[], actionType: string): string | undefined {
  const categoryId = resolveCategory(input, categories);
  if (!categoryId && hasAnyField(input, ['category_id', 'category_name'])) {
    throw new Error(`${actionType} references an unknown category`);
  }
  return categoryId;
}

function resolveRequestedSubcategory(input: Record<string, unknown>, subcategories: Subcategory[], actionType: string): string | undefined {
  const subcategoryId = resolveSubcategory(input, subcategories);
  if (!subcategoryId && hasAnyField(input, ['subcategory_id', 'subcategory_name'])) {
    throw new Error(`${actionType} references an unknown subcategory`);
  }
  return subcategoryId;
}

function resolveGoal(input: Record<string, unknown>, goals: SpendingGoalWithDetails[], subcategories: Subcategory[]): string | undefined {
  const id = asString(input.id);
  if (id) return id;
  const subcategoryId = resolveSubcategory(input, subcategories);
  return goals.find((goal) => goal.subcategory_id === subcategoryId)?.id;
}

function compactContext(): string {
  const accounts = getAccounts();
  const categories = getCategories();
  const subcategories = getSubcategories();
  const goals = getSpendingGoalsWithDetails();
  const recentTransactions = getTransactionsWithDetails({ limit: 25 });

  return JSON.stringify({
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    subcategories: subcategories.map((s) => ({
      id: s.id,
      name: s.name,
      category_id: s.category_id,
      monthly_goal: s.monthly_goal,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      subcategory_id: g.subcategory_id,
      subcategory_name: g.subcategory_name,
      amount: g.amount,
      period: g.period,
      start_date: g.start_date,
      end_date: g.end_date,
    })),
    recentTransactions: recentTransactions.map((t) => ({
      id: t.id,
      date: t.date,
      name: t.name,
      amount: t.amount,
      account_id: t.account_id,
      account_name: t.account_name,
      subcategory_id: t.subcategory_id,
      subcategory_name: t.subcategory_name,
    })),
  });
}

function parseChatResponse(parsed: unknown): AIChatResponse {
  if (!parsed || typeof parsed !== 'object') {
    return { message: 'I could not parse the assistant response.', actions: [] };
  }

  const record = parsed as Record<string, unknown>;
  const actions = Array.isArray(record.actions)
    ? record.actions
      .filter((action): action is Record<string, unknown> => action !== null && typeof action === 'object')
      .map((action) => ({
        type: asString(action.type) ?? 'unknown',
        input: action.input && typeof action.input === 'object'
          ? action.input as Record<string, unknown>
          : {},
      }))
    : [];

  return {
    message: asString(record.message) ?? 'Done.',
    actions,
  };
}

function executeAction(action: AIAction): ExecutedAction {
  const accounts = getAccounts();
  const categories = getCategories();
  const subcategories = getSubcategories();
  const goals = getSpendingGoalsWithDetails();
  const input = action.input;

  try {
    switch (action.type) {
      case 'create_account': {
        const name = asString(input.name);
        const type = requireAccountType(input.type, action.type);
        if (!name) throw new Error('create_account requires name');
        return { ...action, status: 'success', result: createAccount({ name, type, initial_balance: asNumber(input.initial_balance) }) };
      }
      case 'update_account': {
        const id = asString(input.id) ?? resolveAccount(input, accounts);
        if (!id) throw new Error('update_account requires id or existing account name');
        if (!hasAnyField(input, ['name', 'type'])) {
          throw new Error('update_account requires at least one field to update');
        }
        return {
          ...action,
          status: 'success',
          result: updateAccount(id, {
            name: asString(input.name),
            type: optionalAccountType(input.type, action.type),
          }),
        };
      }
      case 'create_category': {
        const name = asString(input.name);
        const type = requireCategoryType(input.type, action.type);
        if (!name) throw new Error('create_category requires name');
        return { ...action, status: 'success', result: createCategory({ name, type }) };
      }
      case 'update_category': {
        const id = asString(input.id) ?? findByName(categories, asString(input.current_name))?.id;
        if (!id) throw new Error('update_category requires id or current_name');
        if (!hasAnyField(input, ['name', 'type'])) {
          throw new Error('update_category requires at least one field to update');
        }
        return {
          ...action,
          status: 'success',
          result: updateCategory(id, {
            name: asString(input.name),
            type: optionalCategoryType(input.type, action.type),
          }),
        };
      }
      case 'create_subcategory': {
        const name = asString(input.name);
        const categoryId = resolveRequestedCategory(input, categories, action.type);
        if (!name || !categoryId) throw new Error('create_subcategory requires name and category_id or category_name');
        return {
          ...action,
          status: 'success',
          result: createSubcategory({
            name,
            category_id: categoryId,
            monthly_goal: optionalNonnegativeNumber(input.monthly_goal, 'monthly_goal', action.type) ?? null,
          }),
        };
      }
      case 'update_subcategory': {
        const id = asString(input.id) ?? resolveSubcategory(input, subcategories);
        if (!id) throw new Error('update_subcategory requires id or current_name');
        if (!hasAnyField(input, ['name', 'category_id', 'category_name', 'monthly_goal'])) {
          throw new Error('update_subcategory requires at least one field to update');
        }
        return {
          ...action,
          status: 'success',
          result: updateSubcategory(id, {
            name: asString(input.name),
            category_id: resolveRequestedCategory(input, categories, action.type),
            monthly_goal: optionalNonnegativeNumber(input.monthly_goal, 'monthly_goal', action.type),
          }),
        };
      }
      case 'create_transaction': {
        const accountId = resolveAccount(input, accounts);
        const date = requireIsoDate(input.date, 'date', action.type);
        const name = asString(input.name);
        const amount = asNumber(input.amount);
        if (!accountId || !name || amount === undefined) {
          throw new Error('create_transaction requires account, date, name, and amount');
        }
        const data: CreateTransactionData = {
          account_id: accountId,
          date,
          name,
          amount,
          subcategory_id: resolveRequestedSubcategory(input, subcategories, action.type) ?? null,
          comment: asNullableString(input.comment) ?? null,
        };
        return { ...action, status: 'success', result: createTransaction(data) };
      }
      case 'update_transaction': {
        const id = asString(input.id);
        if (!id) throw new Error('update_transaction requires id');
        if (!hasAnyField(input, ['date', 'name', 'amount', 'subcategory_id', 'subcategory_name', 'comment'])) {
          throw new Error('update_transaction requires at least one field to update');
        }
        const subcategoryId = input.subcategory_id === null
          ? null
          : resolveRequestedSubcategory(input, subcategories, action.type);
        return {
          ...action,
          status: 'success',
          result: updateTransaction(id, {
            date: optionalIsoDate(input.date, 'date', action.type),
            name: asString(input.name),
            amount: asNumber(input.amount),
            subcategory_id: subcategoryId,
            comment: asNullableString(input.comment),
          }),
        };
      }
      case 'create_goal': {
        const subcategoryId = resolveRequestedSubcategory(input, subcategories, action.type);
        const amount = requirePositiveNumber(input.amount, 'amount', action.type);
        const period = requireGoalPeriod(input.period, action.type);
        const startDate = requireIsoDate(input.start_date, 'start_date', action.type);
        const endDate = optionalNullableIsoDate(input.end_date, 'end_date', action.type) ?? null;
        if (!subcategoryId) throw new Error('create_goal requires subcategory');
        assertDateRange(startDate, endDate, action.type);
        return {
          ...action,
          status: 'success',
          result: createSpendingGoal({
            subcategory_id: subcategoryId,
            amount,
            period,
            start_date: startDate,
            end_date: endDate,
          }),
        };
      }
      case 'update_goal': {
        const id = resolveGoal(input, goals, subcategories);
        if (!id) throw new Error('update_goal requires id or subcategory');
        if (!hasAnyField(input, ['amount', 'period', 'start_date', 'end_date'])) {
          throw new Error('update_goal requires at least one field to update');
        }
        const startDate = optionalIsoDate(input.start_date, 'start_date', action.type);
        const endDate = optionalNullableIsoDate(input.end_date, 'end_date', action.type);
        const existingGoal = goals.find((goal) => goal.id === id);
        assertDateRange(
          startDate ?? existingGoal?.start_date ?? '',
          endDate !== undefined ? endDate : existingGoal?.end_date,
          action.type,
        );
        return {
          ...action,
          status: 'success',
          result: updateSpendingGoal(id, {
            amount: optionalPositiveNumber(input.amount, 'amount', action.type),
            period: optionalGoalPeriod(input.period, action.type),
            start_date: startDate,
            end_date: endDate,
          }),
        };
      }
      default:
        throw new Error(`Unsupported action "${action.type}"`);
    }
  } catch (error) {
    return {
      ...action,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown action error',
    };
  }
}

export async function chatWithAssistant(request: ChatRequest): Promise<ChatResult> {
  const requestId = crypto.randomUUID();
  const systemMessage = `You are LocalFin AI, a local-first personal finance assistant.

Return ONLY JSON: { "message": "short user-facing response", "actions": [{ "type": "...", "input": { ... } }] }.

You may answer questions using the provided context. You may directly perform create/update actions by returning actions. Never delete anything. If a user asks to delete, explain that deletion is not available from chat.

Allowed action types:
- create_account: { name, type: "asset"|"liability", initial_balance? }
- update_account: { id? or current_name, name?, type? }
- create_category: { name, type: "income"|"expense" }
- update_category: { id? or current_name, name?, type? }
- create_subcategory: { name, category_id? or category_name, monthly_goal? }
- update_subcategory: { id? or current_name, name?, category_id? or category_name, monthly_goal? }
- create_transaction: { account_id? or account_name, date: "YYYY-MM-DD", name, amount, subcategory_id? or subcategory_name?, comment? }
- update_transaction: { id, date?, name?, amount?, subcategory_id? or subcategory_name?, comment? }
- create_goal: { subcategory_id? or subcategory_name, amount, period: "weekly"|"monthly"|"quarterly"|"annual", start_date: "YYYY-MM-DD", end_date? }
- update_goal: { id? or subcategory_id? or subcategory_name, amount?, period?, start_date?, end_date? }

Use today's date ${new Date().toISOString().slice(0, 10)} when the user says today.`;

  const response = await callOpenRouter(
    [
      { role: 'system', content: systemMessage },
      {
        role: 'user',
        content: JSON.stringify({
          currentPage: request.currentPage ?? null,
          message: request.message,
          context: compactContext(),
        }),
      },
    ],
    {
      conversationId: request.conversationId,
      requestId,
      operation: 'assistant.chat',
      model: AI_MODELS.assistantChat,
      metadata: { currentPage: request.currentPage ?? null },
    },
  );

  const parsed = parseChatResponse(response.parsedContent);
  const actions = parsed.actions?.map(executeAction) ?? [];

  await appendConversationLog(request.conversationId, {
    timestamp: new Date().toISOString(),
    status: actions.some((action) => action.status === 'error') ? 'partial' : 'success',
    operation: 'assistant.tool_actions',
    conversationId: request.conversationId,
    requestId,
    actions,
  });

  const actionErrors = actions.filter((action) => action.status === 'error');
  const suffix = actionErrors.length > 0
    ? ` ${actionErrors.length} action${actionErrors.length === 1 ? '' : 's'} failed; see the action details.`
    : '';

  return {
    conversationId: request.conversationId,
    requestId,
    message: `${parsed.message}${suffix}`,
    actions,
    logFile: response.logFile,
  };
}
