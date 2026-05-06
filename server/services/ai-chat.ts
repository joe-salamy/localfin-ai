import crypto from 'node:crypto';
import { callOpenRouter, appendConversationLog } from '../ai/openrouter.js';
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
        const type = asString(input.type) as AccountType | undefined;
        if (!name || (type !== 'asset' && type !== 'liability')) {
          throw new Error('create_account requires name and type asset|liability');
        }
        return { ...action, status: 'success', result: createAccount({ name, type, initial_balance: asNumber(input.initial_balance) }) };
      }
      case 'update_account': {
        const id = asString(input.id) ?? resolveAccount(input, accounts);
        if (!id) throw new Error('update_account requires id or existing account name');
        return {
          ...action,
          status: 'success',
          result: updateAccount(id, {
            name: asString(input.name),
            type: asString(input.type) as AccountType | undefined,
          }),
        };
      }
      case 'create_category': {
        const name = asString(input.name);
        const type = asString(input.type) as CategoryType | undefined;
        if (!name || (type !== 'income' && type !== 'expense')) {
          throw new Error('create_category requires name and type income|expense');
        }
        return { ...action, status: 'success', result: createCategory({ name, type }) };
      }
      case 'update_category': {
        const id = asString(input.id) ?? findByName(categories, asString(input.current_name))?.id;
        if (!id) throw new Error('update_category requires id or current_name');
        return {
          ...action,
          status: 'success',
          result: updateCategory(id, {
            name: asString(input.name),
            type: asString(input.type) as CategoryType | undefined,
          }),
        };
      }
      case 'create_subcategory': {
        const name = asString(input.name);
        const categoryId = resolveCategory(input, categories);
        if (!name || !categoryId) throw new Error('create_subcategory requires name and category_id or category_name');
        return {
          ...action,
          status: 'success',
          result: createSubcategory({
            name,
            category_id: categoryId,
            monthly_goal: asNumber(input.monthly_goal) ?? null,
          }),
        };
      }
      case 'update_subcategory': {
        const id = asString(input.id) ?? resolveSubcategory(input, subcategories);
        if (!id) throw new Error('update_subcategory requires id or current_name');
        return {
          ...action,
          status: 'success',
          result: updateSubcategory(id, {
            name: asString(input.name),
            category_id: resolveCategory(input, categories),
            monthly_goal: input.monthly_goal === null ? null : asNumber(input.monthly_goal),
          }),
        };
      }
      case 'create_transaction': {
        const accountId = resolveAccount(input, accounts);
        const date = asString(input.date);
        const name = asString(input.name);
        const amount = asNumber(input.amount);
        if (!accountId || !date || !name || amount === undefined) {
          throw new Error('create_transaction requires account, date, name, and amount');
        }
        const data: CreateTransactionData = {
          account_id: accountId,
          date,
          name,
          amount,
          subcategory_id: resolveSubcategory(input, subcategories) ?? null,
          comment: asNullableString(input.comment) ?? null,
        };
        return { ...action, status: 'success', result: createTransaction(data) };
      }
      case 'update_transaction': {
        const id = asString(input.id);
        if (!id) throw new Error('update_transaction requires id');
        return {
          ...action,
          status: 'success',
          result: updateTransaction(id, {
            date: asString(input.date),
            name: asString(input.name),
            amount: asNumber(input.amount),
            subcategory_id: input.subcategory_id === null
              ? null
              : resolveSubcategory(input, subcategories),
            comment: asNullableString(input.comment),
          }),
        };
      }
      case 'create_goal': {
        const subcategoryId = resolveSubcategory(input, subcategories);
        const amount = asNumber(input.amount);
        const period = asString(input.period) as GoalPeriod | undefined;
        const startDate = asString(input.start_date);
        if (!subcategoryId || amount === undefined || !period || !startDate) {
          throw new Error('create_goal requires subcategory, amount, period, and start_date');
        }
        return {
          ...action,
          status: 'success',
          result: createSpendingGoal({
            subcategory_id: subcategoryId,
            amount,
            period,
            start_date: startDate,
            end_date: asNullableString(input.end_date) ?? null,
          }),
        };
      }
      case 'update_goal': {
        const id = resolveGoal(input, goals, subcategories);
        if (!id) throw new Error('update_goal requires id or subcategory');
        return {
          ...action,
          status: 'success',
          result: updateSpendingGoal(id, {
            amount: asNumber(input.amount),
            period: asString(input.period) as GoalPeriod | undefined,
            start_date: asString(input.start_date),
            end_date: asNullableString(input.end_date),
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
