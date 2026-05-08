import crypto from "node:crypto";
import {
  appendConversationLog,
  streamOpenRouter,
  type OpenRouterReasoningDetail,
} from "../ai/openrouter.js";
import { AI_MODELS } from "../config/ai-models.js";
import { createAccount, getAccounts, updateAccount } from "./accounts.js";
import {
  createCategory,
  createSubcategory,
  getCategories,
  getSubcategories,
  updateCategory,
  updateSubcategory,
} from "./categories.js";
import {
  createSpendingGoal,
  getSpendingGoalsWithDetails,
  updateSpendingGoal,
} from "./goals.js";
import {
  createTransaction,
  getTransactionsWithDetails,
  updateTransaction,
} from "./transactions.js";
import type {
  Account,
  AccountType,
  Category,
  CategoryType,
  CreateTransactionData,
  GoalPeriod,
  SpendingGoalWithDetails,
  Subcategory,
  TransactionWithDetails,
} from "../../src/types/index.js";

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
  status: "success" | "error";
  result?: unknown;
  error?: string;
}

interface PlanningContext {
  accounts: Account[];
  categories: Category[];
  subcategories: Subcategory[];
  recentTransactions: TransactionWithDetails[];
}

interface SearchActionResult {
  action: AIAction;
  executedAction: ExecutedAction;
}

export interface ChatResult {
  conversationId: string;
  requestId: string;
  message: string;
  actions: ExecutedAction[];
  logFile: string;
}

export type ChatStreamEvent =
  | { type: "started"; conversationId: string; requestId: string }
  | { type: "thinking"; message: string }
  | { type: "reasoning_delta"; message: string }
  | { type: "reasoning_details"; details: OpenRouterReasoningDetail[] }
  | { type: "response_delta"; content: string }
  | { type: "actions_planned"; actions: AIAction[] }
  | { type: "action_started"; index: number; action: AIAction }
  | { type: "action_finished"; index: number; action: ExecutedAction }
  | { type: "final"; data: ChatResult };

type ChatStreamEmitter = (event: ChatStreamEvent) => void | Promise<void>;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return asString(value);
}

function hasField(input: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function hasAnyField(
  input: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.some((field) => hasField(input, field));
}

function requireAccountType(value: unknown, actionType: string): AccountType {
  if (value === "asset" || value === "liability") return value;
  throw new Error(`${actionType} requires type asset|liability`);
}

function optionalAccountType(
  value: unknown,
  actionType: string,
): AccountType | undefined {
  if (value === undefined) return undefined;
  return requireAccountType(value, actionType);
}

function requireCategoryType(value: unknown, actionType: string): CategoryType {
  if (value === "income" || value === "expense") return value;
  throw new Error(`${actionType} requires type income|expense`);
}

function optionalCategoryType(
  value: unknown,
  actionType: string,
): CategoryType | undefined {
  if (value === undefined) return undefined;
  return requireCategoryType(value, actionType);
}

function requireGoalPeriod(value: unknown, actionType: string): GoalPeriod {
  if (
    value === "weekly" ||
    value === "monthly" ||
    value === "quarterly" ||
    value === "annual"
  ) {
    return value;
  }
  throw new Error(
    `${actionType} requires period weekly|monthly|quarterly|annual`,
  );
}

function optionalGoalPeriod(
  value: unknown,
  actionType: string,
): GoalPeriod | undefined {
  if (value === undefined) return undefined;
  return requireGoalPeriod(value, actionType);
}

function requirePositiveNumber(
  value: unknown,
  field: string,
  actionType: string,
): number {
  const numberValue = asNumber(value);
  if (numberValue === undefined || numberValue <= 0) {
    throw new Error(`${actionType} requires positive ${field}`);
  }
  return numberValue;
}

function optionalPositiveNumber(
  value: unknown,
  field: string,
  actionType: string,
): number | undefined {
  if (value === undefined) return undefined;
  return requirePositiveNumber(value, field, actionType);
}

function optionalNonnegativeNumber(
  value: unknown,
  field: string,
  actionType: string,
): number | null | undefined {
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
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function requireIsoDate(
  value: unknown,
  field: string,
  actionType: string,
): string {
  const date = asString(value);
  if (!date || !isIsoDate(date)) {
    throw new Error(`${actionType} requires ${field} in YYYY-MM-DD format`);
  }
  return date;
}

function optionalIsoDate(
  value: unknown,
  field: string,
  actionType: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requireIsoDate(value, field, actionType);
}

function optionalNullableIsoDate(
  value: unknown,
  field: string,
  actionType: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireIsoDate(value, field, actionType);
}

function assertDateRange(
  startDate: string,
  endDate: string | null | undefined,
  actionType: string,
): void {
  if (endDate && startDate > endDate) {
    throw new Error(`${actionType} requires start_date on or before end_date`);
  }
}

function findByName<T extends { name: string }>(
  items: T[],
  name?: string,
): T | undefined {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === normalized);
}

function resolveAccount(
  input: Record<string, unknown>,
  accounts: Account[],
): string | undefined {
  return (
    asString(input.account_id) ??
    findByName(
      accounts,
      asString(input.account_name) ?? asString(input.current_name),
    )?.id
  );
}

function resolveRequestedAccount(
  input: Record<string, unknown>,
  accounts: Account[],
  actionType: string,
): string | undefined {
  const accountId = resolveAccount(input, accounts);
  if (!accountId && hasAnyField(input, ["account_id", "account_name"])) {
    throw new Error(`${actionType} references an unknown account`);
  }
  return accountId;
}

function resolveCategory(
  input: Record<string, unknown>,
  categories: Category[],
): string | undefined {
  return (
    asString(input.category_id) ??
    findByName(categories, asString(input.category_name))?.id
  );
}

function resolveSubcategory(
  input: Record<string, unknown>,
  subcategories: Subcategory[],
): string | undefined {
  return (
    asString(input.subcategory_id) ??
    findByName(
      subcategories,
      asString(input.subcategory_name) ?? asString(input.current_name),
    )?.id
  );
}

function resolveRequestedCategory(
  input: Record<string, unknown>,
  categories: Category[],
  actionType: string,
): string | undefined {
  const categoryId = resolveCategory(input, categories);
  if (!categoryId && hasAnyField(input, ["category_id", "category_name"])) {
    throw new Error(`${actionType} references an unknown category`);
  }
  return categoryId;
}

function resolveRequestedSubcategory(
  input: Record<string, unknown>,
  subcategories: Subcategory[],
  actionType: string,
): string | undefined {
  const subcategoryId = resolveSubcategory(input, subcategories);
  if (
    !subcategoryId &&
    hasAnyField(input, ["subcategory_id", "subcategory_name"])
  ) {
    throw new Error(`${actionType} references an unknown subcategory`);
  }
  return subcategoryId;
}

function resolveGoal(
  input: Record<string, unknown>,
  goals: SpendingGoalWithDetails[],
  subcategories: Subcategory[],
): string | undefined {
  const id = asString(input.id);
  if (id) return id;
  const subcategoryId = resolveSubcategory(input, subcategories);
  return goals.find((goal) => goal.subcategory_id === subcategoryId)?.id;
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function includesNormalized(haystack: string, needle: string): boolean {
  return normalizeForMatch(haystack).includes(normalizeForMatch(needle));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cloneAction(action: AIAction): AIAction {
  return { type: action.type, input: { ...action.input } };
}

function categoryTypeForSubcategory(
  input: Record<string, unknown>,
  categories: Category[],
  subcategories: Subcategory[],
): CategoryType | undefined {
  const subcategoryId = resolveSubcategory(input, subcategories);
  if (!subcategoryId) return undefined;
  const subcategory = subcategories.find((item) => item.id === subcategoryId);
  if (!subcategory) return undefined;
  return categories.find((category) => category.id === subcategory.category_id)
    ?.type;
}

function promptAnchorsForAction(action: AIAction): string[] {
  return [
    asString(action.input.name),
    asString(action.input.comment),
    asString(action.input.account_name),
    asString(action.input.subcategory_name),
  ].filter((value): value is string => Boolean(value));
}

function nearestExplicitSignForAmount(
  message: string,
  action: AIAction,
  amount: number,
): "+" | "-" | undefined {
  const absAmount = Math.abs(amount);
  const amountPatterns = Array.from(
    new Set([String(absAmount), absAmount.toFixed(2)]),
  ).map((value) => escapeRegExp(value).replace("\\.", "\\."));
  const regex = new RegExp(`([+-])\\s*(?:${amountPatterns.join("|")})`, "gi");
  const matches = Array.from(message.matchAll(regex));
  if (matches.length === 0) return undefined;

  const anchorIndexes = promptAnchorsForAction(action)
    .flatMap((anchor) => {
      const indexes: number[] = [];
      let index = normalizeForMatch(message).indexOf(normalizeForMatch(anchor));
      while (index !== -1) {
        indexes.push(index);
        index = normalizeForMatch(message).indexOf(
          normalizeForMatch(anchor),
          index + 1,
        );
      }
      return indexes;
    })
    .filter((index) => index >= 0);

  if (anchorIndexes.length === 0) {
    return matches.length === 1 ? (matches[0]?.[1] as "+" | "-") : undefined;
  }

  let best:
    | {
        sign: "+" | "-";
        distance: number;
      }
    | undefined;
  for (const match of matches) {
    const sign = match[1] as "+" | "-";
    const matchIndex = match.index ?? 0;
    const distance = Math.min(
      ...anchorIndexes.map((anchorIndex) => Math.abs(anchorIndex - matchIndex)),
    );
    if (!best || distance < best.distance) {
      best = { sign, distance };
    }
  }

  return best && best.distance <= 180 ? best.sign : undefined;
}

function hasIncomeCue(action: AIAction): boolean {
  const text = promptAnchorsForAction(action).join(" ");
  return /\b(reimbursement|refund|deposit|payroll|paycheck|income|interest|credit(?!\s+card))\b/i.test(
    text,
  );
}

function hasExpenseCue(message: string, action: AIAction): boolean {
  const text = `${message} ${promptAnchorsForAction(action).join(" ")}`;
  return /\b(charge|purchase|bought|buy|bill|spending|expense|grocer|restaurant|ride|rideshare|flight|hotel|lunch|coffee|fuel|subscription)\b/i.test(
    text,
  );
}

function signedAmountNearIncomeCue(message: string, amount: number): boolean {
  const absAmount = Math.abs(amount);
  const amountPatterns = Array.from(
    new Set([String(absAmount), absAmount.toFixed(2)]),
  ).map((value) => escapeRegExp(value).replace("\\.", "\\."));
  const signedAmount = `\\+\\s*(?:${amountPatterns.join("|")})`;
  const incomeCue =
    "\\b(?:reimbursement|refund|deposit|payroll|paycheck|income|interest|credit)\\b";
  return new RegExp(
    `(?:${signedAmount}[\\s\\S]{0,90}${incomeCue})|(?:${incomeCue}[\\s\\S]{0,90}${signedAmount})`,
    "i",
  ).test(message);
}

function normalizeTransactionAmount(
  action: AIAction,
  message: string,
  categories: Category[],
  subcategories: Subcategory[],
): AIAction {
  const amount = asNumber(action.input.amount);
  if (action.type !== "create_transaction" || amount === undefined) {
    return action;
  }

  const explicitSign = nearestExplicitSignForAmount(message, action, amount);
  const categoryType = categoryTypeForSubcategory(
    action.input,
    categories,
    subcategories,
  );
  if (
    explicitSign &&
    !(
      explicitSign === "+" &&
      categoryType === "expense" &&
      !hasIncomeCue(action) &&
      (/\b(reimbursement|refund|deposit|payroll|paycheck|income|interest|credit)\b/i.test(
        message,
      ) ||
        signedAmountNearIncomeCue(message, amount))
    )
  ) {
    return {
      ...action,
      input: {
        ...action.input,
        amount: explicitSign === "+" ? Math.abs(amount) : -Math.abs(amount),
      },
    };
  }

  if (categoryType === "expense" && amount > 0 && !hasIncomeCue(action)) {
    return { ...action, input: { ...action.input, amount: -amount } };
  }
  if (categoryType === "income" && amount < 0 && !hasExpenseCue(message, action)) {
    return { ...action, input: { ...action.input, amount: Math.abs(amount) } };
  }
  if (!categoryType && amount > 0 && hasExpenseCue(message, action)) {
    return { ...action, input: { ...action.input, amount: -amount } };
  }

  return action;
}

function normalizeTransactionText(action: AIAction, message: string): AIAction {
  if (action.type !== "create_transaction") return action;
  const name = asString(action.input.name);
  const comment = asString(action.input.comment);
  const subcategoryName = asString(action.input.subcategory_name);
  const input = { ...action.input };

  if (
    /\breimbursement\b/i.test(message) &&
    subcategoryName &&
    includesNormalized(subcategoryName, "Reimbursements") &&
    name &&
    !/\breimbursement\b/i.test(name)
  ) {
    input.name = `Reimbursement - ${name}`;
  }

  if (
    /\bpayment to Test Credit Card\b/i.test(message) &&
    name &&
    /\bpayment\b/i.test(name) &&
    includesNormalized(asString(action.input.account_name) ?? "", "Test Checking") &&
    !/\bCredit Card\b/i.test(comment ?? "")
  ) {
    input.comment = "payment to Test Credit Card";
  }

  if (
    /\bpayment from checking\b/i.test(message) &&
    name &&
    /\bpayment\b/i.test(name) &&
    includesNormalized(asString(action.input.account_name) ?? "", "Test Credit Card")
  ) {
    input.comment = "payment from checking";
  }

  return { ...action, input };
}

function normalizeCreateTransactionAction(
  action: AIAction,
  message: string,
  context: PlanningContext,
): AIAction {
  return normalizeTransactionText(
    normalizeTransactionAmount(
      cloneAction(action),
      message,
      context.categories,
      context.subcategories,
    ),
    message,
  );
}

function quoteSearchValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function searchActionForTransactionUpdate(
  action: AIAction,
  context: PlanningContext,
): AIAction | undefined {
  const id = asString(action.input.id);
  if (!id) return undefined;
  const transaction = context.recentTransactions.find((item) => item.id === id);
  if (!transaction) return undefined;

  const clauses = [
    `name:${quoteSearchValue(transaction.name)}`,
    transaction.account_name
      ? `account:${quoteSearchValue(transaction.account_name)}`
      : undefined,
    `date>=${transaction.date}`,
    `date<=${transaction.date}`,
  ].filter((clause): clause is string => Boolean(clause));

  return {
    type: "search_transactions",
    input: { searchQuery: clauses.join(" AND "), limit: 10 },
  };
}

function shouldInsertSearchBeforeUpdate(
  actions: AIAction[],
  updateIndex: number,
): boolean {
  return !actions
    .slice(0, updateIndex)
    .some((action) => action.type === "search_transactions");
}

function visibleFailureFromMessage(
  actions: AIAction[],
  message: string,
  assistantMessage: string,
): AIAction | undefined {
  if (actions.length > 0) return undefined;
  if (/\b(delete|remove)\b/i.test(message)) return undefined;
  if (/\bnone match|no matching\b/i.test(assistantMessage)) return undefined;
  if (!/\b(add|create|update|rename|change|record)\b/i.test(message)) {
    return undefined;
  }
  if (
    !/\b(cannot|can't|could not|couldn't|not found|invalid|already exists|conflict)\b/i.test(
      assistantMessage,
    )
  ) {
    return undefined;
  }

  return {
    type: "report_failure",
    input: { reason: assistantMessage },
  };
}

export function prepareActionsForExecution(
  actions: AIAction[],
  message: string,
  assistantMessage: string,
  context: PlanningContext,
): AIAction[] {
  const prepared = actions.map((action) =>
    action.type === "create_transaction"
      ? normalizeCreateTransactionAction(action, message, context)
      : cloneAction(action),
  );

  const visibleFailure = visibleFailureFromMessage(
    prepared,
    message,
    assistantMessage,
  );
  if (visibleFailure) return [visibleFailure];

  const withSearches: AIAction[] = [];
  for (const action of prepared) {
    if (
      action.type === "update_transaction" &&
      shouldInsertSearchBeforeUpdate(withSearches, withSearches.length)
    ) {
      const searchAction = searchActionForTransactionUpdate(action, context);
      if (searchAction) withSearches.push(searchAction);
    }
    withSearches.push(action);
  }

  return withSearches;
}

function requestedUpdateComment(message: string): string | undefined {
  const patterns = [
    /\bcomment\s+(?:to|says?)\s+['"]([^'"]+)['"]/i,
    /\bcomment\s+['"]([^'"]+)['"]/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function requestedUpdateSubcategory(
  message: string,
  subcategories: Subcategory[],
): string | undefined {
  const directMatch = message.match(/\bsubcategory\s+is\s+([A-Za-z][\w -]+)/i);
  const directName = directMatch?.[1]?.trim().replace(/[.?!,].*$/, "");
  if (directName && findByName(subcategories, directName)) return directName;

  return subcategories.find((subcategory) =>
    new RegExp(`\\b(?:keep it in|in|under|as)\\s+${escapeRegExp(subcategory.name)}\\b`, "i").test(
      message,
    ),
  )?.name;
}

function tokenScore(message: string, transaction: TransactionWithDetails): number {
  const prompt = normalizeForMatch(message);
  const candidates = [
    transaction.name,
    transaction.comment ?? "",
    transaction.account_name ?? "",
    transaction.subcategory_name ?? "",
    transaction.category_name ?? "",
  ];
  let score = 0;
  for (const candidate of candidates) {
    for (const token of candidate.split(/\s+/)) {
      const normalized = normalizeForMatch(token).replace(/[^a-z0-9]/g, "");
      if (normalized.length >= 4 && prompt.includes(normalized)) score += 1;
    }
  }
  return score;
}

function resultTransactions(result: unknown): TransactionWithDetails[] {
  if (!Array.isArray(result)) return [];
  return result.filter(
    (item): item is TransactionWithDetails =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as TransactionWithDetails).id === "string" &&
      typeof (item as TransactionWithDetails).name === "string",
  );
}

function chooseSearchUpdateTarget(
  message: string,
  results: TransactionWithDetails[],
): TransactionWithDetails | undefined {
  if (results.length === 1) return results[0];
  const scored = results
    .map((transaction) => ({ transaction, score: tokenScore(message, transaction) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score === 0) return undefined;
  if (second && second.score === best.score) return undefined;
  return best.transaction;
}

function shouldRepairSearchOnlyUpdate(
  actions: AIAction[],
  message: string,
): boolean {
  return (
    /\b(search|find|use)\b[\s\S]*\bupdate\b/i.test(message) &&
    actions.some((action) => action.type === "search_transactions") &&
    !actions.some((action) => action.type === "update_transaction")
  );
}

export function buildSearchUpdateFollowUp(
  actions: AIAction[],
  message: string,
  searchResult: SearchActionResult,
  subcategories: Subcategory[],
): AIAction | undefined {
  if (!shouldRepairSearchOnlyUpdate(actions, message)) return undefined;
  const results = resultTransactions(searchResult.executedAction.result);
  const target = chooseSearchUpdateTarget(message, results);
  if (!target) {
    return {
      type: "report_failure",
      input: { reason: "Could not choose one transaction to update." },
    };
  }

  const comment = requestedUpdateComment(message);
  const subcategoryName = requestedUpdateSubcategory(message, subcategories);
  if (!comment && !subcategoryName) {
    return {
      type: "report_failure",
      input: { reason: "Could not infer requested transaction update." },
    };
  }

  return {
    type: "update_transaction",
    input: {
      id: target.id,
      ...(comment ? { comment } : {}),
      ...(subcategoryName ? { subcategory_name: subcategoryName } : {}),
    },
  };
}

function compactContext(): string {
  const accounts = getAccounts();
  const categories = getCategories();
  const subcategories = getSubcategories();
  const goals = getSpendingGoalsWithDetails();
  const recentTransactions = getTransactionsWithDetails({ limit: 25 });

  return JSON.stringify({
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
    })),
    subcategories: subcategories.map((s) => ({
      id: s.id,
      name: s.name,
      category_id: s.category_id,
      category_name: categories.find((category) => category.id === s.category_id)
        ?.name,
      category_type: categories.find((category) => category.id === s.category_id)
        ?.type,
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
      comment: t.comment,
    })),
  });
}

function parseChatResponse(parsed: unknown): AIChatResponse {
  if (!parsed || typeof parsed !== "object") {
    return {
      message: "I could not parse the assistant response.",
      actions: [],
    };
  }

  const record = parsed as Record<string, unknown>;
  const actions = Array.isArray(record.actions)
    ? record.actions
        .filter(
          (action): action is Record<string, unknown> =>
            action !== null && typeof action === "object",
        )
        .map((action) => ({
          type: asString(action.type) ?? "unknown",
          input:
            action.input && typeof action.input === "object"
              ? (action.input as Record<string, unknown>)
              : {},
        }))
    : [];

  return {
    message: asString(record.message) ?? "Done.",
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
      case "report_failure": {
        throw new Error(
          asString(input.reason) ?? "Assistant reported an action failure",
        );
      }
      case "create_account": {
        const name = asString(input.name);
        const type = requireAccountType(input.type, action.type);
        if (!name) throw new Error("create_account requires name");
        return {
          ...action,
          status: "success",
          result: createAccount({
            name,
            type,
            initial_balance: asNumber(input.initial_balance),
          }),
        };
      }
      case "update_account": {
        const id = asString(input.id) ?? resolveAccount(input, accounts);
        if (!id)
          throw new Error(
            "update_account requires id or existing account name",
          );
        if (!hasAnyField(input, ["name", "type"])) {
          throw new Error(
            "update_account requires at least one field to update",
          );
        }
        return {
          ...action,
          status: "success",
          result: updateAccount(id, {
            name: asString(input.name),
            type: optionalAccountType(input.type, action.type),
          }),
        };
      }
      case "create_category": {
        const name = asString(input.name);
        const type = requireCategoryType(input.type, action.type);
        if (!name) throw new Error("create_category requires name");
        return {
          ...action,
          status: "success",
          result: createCategory({ name, type }),
        };
      }
      case "update_category": {
        const id =
          asString(input.id) ??
          findByName(categories, asString(input.current_name))?.id;
        if (!id) throw new Error("update_category requires id or current_name");
        if (!hasAnyField(input, ["name", "type"])) {
          throw new Error(
            "update_category requires at least one field to update",
          );
        }
        return {
          ...action,
          status: "success",
          result: updateCategory(id, {
            name: asString(input.name),
            type: optionalCategoryType(input.type, action.type),
          }),
        };
      }
      case "create_subcategory": {
        const name = asString(input.name);
        const categoryId = resolveRequestedCategory(
          input,
          categories,
          action.type,
        );
        if (!name || !categoryId)
          throw new Error(
            "create_subcategory requires name and category_id or category_name",
          );
        return {
          ...action,
          status: "success",
          result: createSubcategory({
            name,
            category_id: categoryId,
            monthly_goal:
              optionalNonnegativeNumber(
                input.monthly_goal,
                "monthly_goal",
                action.type,
              ) ?? null,
          }),
        };
      }
      case "update_subcategory": {
        const id =
          asString(input.id) ?? resolveSubcategory(input, subcategories);
        if (!id)
          throw new Error("update_subcategory requires id or current_name");
        if (
          !hasAnyField(input, [
            "name",
            "category_id",
            "category_name",
            "monthly_goal",
          ])
        ) {
          throw new Error(
            "update_subcategory requires at least one field to update",
          );
        }
        return {
          ...action,
          status: "success",
          result: updateSubcategory(id, {
            name: asString(input.name),
            category_id: resolveRequestedCategory(
              input,
              categories,
              action.type,
            ),
            monthly_goal: optionalNonnegativeNumber(
              input.monthly_goal,
              "monthly_goal",
              action.type,
            ),
          }),
        };
      }
      case "create_transaction": {
        const accountId = resolveAccount(input, accounts);
        const date = requireIsoDate(input.date, "date", action.type);
        const name = asString(input.name);
        const amount = asNumber(input.amount);
        if (!accountId || !name || amount === undefined) {
          throw new Error(
            "create_transaction requires account, date, name, and amount",
          );
        }
        const data: CreateTransactionData = {
          account_id: accountId,
          date,
          name,
          amount,
          subcategory_id:
            resolveRequestedSubcategory(input, subcategories, action.type) ??
            null,
          comment: asNullableString(input.comment) ?? null,
        };
        return {
          ...action,
          status: "success",
          result: createTransaction(data),
        };
      }
      case "search_transactions": {
        const searchQuery = asString(input.searchQuery);
        if (!searchQuery) {
          throw new Error("search_transactions requires searchQuery");
        }
        const requestedLimit = asNumber(input.limit);
        const limit = Math.min(Math.max(requestedLimit ?? 25, 1), 100);
        const transactions = getTransactionsWithDetails({
          searchQuery,
          accountId: resolveRequestedAccount(input, accounts, action.type),
          subcategoryId: resolveRequestedSubcategory(
            input,
            subcategories,
            action.type,
          ),
          startDate:
            optionalIsoDate(input.startDate, "startDate", action.type) ??
            optionalIsoDate(input.start_date, "start_date", action.type),
          endDate:
            optionalIsoDate(input.endDate, "endDate", action.type) ??
            optionalIsoDate(input.end_date, "end_date", action.type),
          limit,
        });

        return {
          ...action,
          status: "success",
          result: transactions.map((transaction) => ({
            id: transaction.id,
            date: transaction.date,
            name: transaction.name,
            amount: transaction.amount,
            account_id: transaction.account_id,
            account_name: transaction.account_name,
            category_name: transaction.category_name,
            subcategory_name: transaction.subcategory_name,
            comment: transaction.comment,
          })),
        };
      }
      case "update_transaction": {
        const id = asString(input.id);
        if (!id) throw new Error("update_transaction requires id");
        if (
          !hasAnyField(input, [
            "date",
            "name",
            "amount",
            "subcategory_id",
            "subcategory_name",
            "comment",
          ])
        ) {
          throw new Error(
            "update_transaction requires at least one field to update",
          );
        }
        const subcategoryId =
          input.subcategory_id === null
            ? null
            : resolveRequestedSubcategory(input, subcategories, action.type);
        return {
          ...action,
          status: "success",
          result: updateTransaction(id, {
            date: optionalIsoDate(input.date, "date", action.type),
            name: asString(input.name),
            amount: asNumber(input.amount),
            subcategory_id: subcategoryId,
            comment: asNullableString(input.comment),
          }),
        };
      }
      case "create_goal": {
        const subcategoryId = resolveRequestedSubcategory(
          input,
          subcategories,
          action.type,
        );
        const amount = requirePositiveNumber(
          input.amount,
          "amount",
          action.type,
        );
        const period = requireGoalPeriod(input.period, action.type);
        const startDate = requireIsoDate(
          input.start_date,
          "start_date",
          action.type,
        );
        const endDate =
          optionalNullableIsoDate(input.end_date, "end_date", action.type) ??
          null;
        if (!subcategoryId) throw new Error("create_goal requires subcategory");
        assertDateRange(startDate, endDate, action.type);
        return {
          ...action,
          status: "success",
          result: createSpendingGoal({
            subcategory_id: subcategoryId,
            amount,
            period,
            start_date: startDate,
            end_date: endDate,
          }),
        };
      }
      case "update_goal": {
        const id = resolveGoal(input, goals, subcategories);
        if (!id) throw new Error("update_goal requires id or subcategory");
        if (
          !hasAnyField(input, ["amount", "period", "start_date", "end_date"])
        ) {
          throw new Error("update_goal requires at least one field to update");
        }
        const startDate = optionalIsoDate(
          input.start_date,
          "start_date",
          action.type,
        );
        const endDate = optionalNullableIsoDate(
          input.end_date,
          "end_date",
          action.type,
        );
        const existingGoal = goals.find((goal) => goal.id === id);
        assertDateRange(
          startDate ?? existingGoal?.start_date ?? "",
          endDate !== undefined ? endDate : existingGoal?.end_date,
          action.type,
        );
        return {
          ...action,
          status: "success",
          result: updateSpendingGoal(id, {
            amount: optionalPositiveNumber(input.amount, "amount", action.type),
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
      status: "error",
      error: error instanceof Error ? error.message : "Unknown action error",
    };
  }
}

function assistantSystemMessage(): string {
  return `You are LocalFin AI, a local-first personal finance assistant.

Return ONLY JSON: { "message": "short user-facing response", "actions": [{ "type": "...", "input": { ... } }] }.

You may answer questions using the provided context. You may directly perform create/update actions by returning actions. Never delete anything. If a user asks to delete, explain that deletion is not available from chat.

Amount conventions:
- Spending, purchases, bills, charges, rides, meals, groceries, fuel, hotels, flights, and subscriptions are negative amounts unless the user explicitly wrote a plus sign.
- Deposits, payroll, reimbursements, refunds, interest, and income are positive amounts unless the user explicitly wrote a minus sign.
- Preserve explicit + and - signs from the user's request.

Failure conventions:
- If the user asks you to create or update something but it cannot be done because a referenced account/category/subcategory is missing, a date is invalid, or a name conflicts, still return the attempted action so validation can fail visibly.
- If the user asks to delete, return no delete action and explain deletion is unavailable.

Allowed action types:
- create_account: { name, type: "asset"|"liability", initial_balance? }
- update_account: { id? or current_name, name?, type? }
- create_category: { name, type: "income"|"expense" }
- update_category: { id? or current_name, name?, type? }
- create_subcategory: { name, category_id? or category_name, monthly_goal? }
- update_subcategory: { id? or current_name, name?, category_id? or category_name, monthly_goal? }
- create_transaction: { account_id? or account_name, date: "YYYY-MM-DD", name, amount, subcategory_id? or subcategory_name?, comment? }
- search_transactions: { searchQuery, account_id? or account_name?, subcategory_id? or subcategory_name?, startDate?, endDate?, limit? }
- update_transaction: { id, date?, name?, amount?, subcategory_id? or subcategory_name?, comment? }
- create_goal: { subcategory_id? or subcategory_name, amount, period: "weekly"|"monthly"|"quarterly"|"annual", start_date: "YYYY-MM-DD", end_date? }
- update_goal: { id? or subcategory_id? or subcategory_name, amount?, period?, start_date?, end_date? }

Transaction search supports grep-like logic in searchQuery: quoted phrases, parentheses, AND, OR, NOT, |, -term, and fields name:, comment:, account:, category:, subcategory:, amount/date comparisons such as amount>20 and date>=2026-01-01. Examples: "coffee AND NOT starbucks", "(uber OR lyft) AND amount>20", "account:checking AND category:food AND date>=2026-01-01". Any request phrased as find/search/use criteria and then update must include search_transactions followed by update_transaction. Use search_transactions before update_transaction when the user describes a transaction but does not provide its id.

Use today's date ${new Date().toISOString().slice(0, 10)} when the user says today.`;
}

async function runAssistantChat(
  request: ChatRequest,
  emit?: ChatStreamEmitter,
): Promise<ChatResult> {
  const requestId = crypto.randomUUID();
  await emit?.({
    type: "started",
    conversationId: request.conversationId,
    requestId,
  });
  await emit?.({
    type: "thinking",
    message: "Reading your finance context and planning actions...",
  });

  const response = await streamOpenRouter(
    [
      { role: "system", content: assistantSystemMessage() },
      {
        role: "user",
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
      operation: "assistant.chat",
      model: AI_MODELS.assistantChat,
      metadata: { currentPage: request.currentPage ?? null },
    },
    async (event) => {
      switch (event.type) {
        case "reasoning_delta":
          await emit?.({ type: "reasoning_delta", message: event.reasoning });
          return;
        case "reasoning_details":
          await emit?.({ type: "reasoning_details", details: event.details });
          return;
        case "content_delta":
          await emit?.({ type: "response_delta", content: event.content });
          return;
        default:
          return;
      }
    },
  );

  const parsed = parseChatResponse(response.parsedContent);
  const planningContext: PlanningContext = {
    accounts: getAccounts(),
    categories: getCategories(),
    subcategories: getSubcategories(),
    recentTransactions: getTransactionsWithDetails({ limit: 25 }),
  };
  const plannedActions = prepareActionsForExecution(
    parsed.actions ?? [],
    request.message,
    parsed.message,
    planningContext,
  );
  await emit?.({ type: "actions_planned", actions: plannedActions });

  const actions: ExecutedAction[] = [];
  for (let index = 0; index < plannedActions.length; index += 1) {
    const action = plannedActions[index];
    if (!action) continue;
    await emit?.({ type: "action_started", index, action });
    const executedAction = executeAction(action);
    actions.push(executedAction);
    await emit?.({ type: "action_finished", index, action: executedAction });

    if (action.type === "search_transactions") {
      const followUp = buildSearchUpdateFollowUp(
        plannedActions,
        request.message,
        { action, executedAction },
        getSubcategories(),
      );
      if (followUp) {
        plannedActions.splice(index + 1, 0, followUp);
      }
    }
  }

  await appendConversationLog(request.conversationId, {
    timestamp: new Date().toISOString(),
    status: actions.some((action) => action.status === "error")
      ? "partial"
      : "success",
    operation: "assistant.tool_actions",
    conversationId: request.conversationId,
    requestId,
    actions,
  });

  const actionErrors = actions.filter((action) => action.status === "error");
  const suffix =
    actionErrors.length > 0
      ? ` ${actionErrors.length} action${actionErrors.length === 1 ? "" : "s"} failed; see the action details.`
      : "";

  const result = {
    conversationId: request.conversationId,
    requestId,
    message: `${parsed.message}${suffix}`,
    actions,
    logFile: response.logFile,
  };

  await emit?.({ type: "final", data: result });
  return result;
}

export async function chatWithAssistant(
  request: ChatRequest,
): Promise<ChatResult> {
  return runAssistantChat(request);
}

export async function streamChatWithAssistant(
  request: ChatRequest,
  emit: ChatStreamEmitter,
): Promise<ChatResult> {
  return runAssistantChat(request, emit);
}
