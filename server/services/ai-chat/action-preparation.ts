import type {
  Account,
  Category,
  CategoryType,
  Subcategory,
  TransactionKind,
  TransactionWithDetails,
} from "../../../src/types/index.js";
import type { getTransactionsWithDetails } from "../transactions.js";
import type {
  AIAction,
  PlanningContext,
  SearchActionResult,
  ToolLoopState,
} from "./types.js";
import {
  asNumber,
  asNullableString,
  asString,
  hasAnyField,
  hasField,
  isIsoDate,
  optionalIsoDate,
  optionalNonnegativeNumber,
  optionalNullableIsoDate,
  optionalPositiveInteger,
  optionalTransactionKind,
  requireGoalPeriod,
  requireIsoDate,
  requirePositiveNumber,
} from "./input-validators.js";
import {
  findByName,
  resolveRequestedAccount,
  resolveRequestedSubcategory,
  resolveSubcategory,
} from "./entity-resolution.js";

export function transactionSearchFilters(
  input: Record<string, unknown>,
  accounts: Account[],
  subcategories: Subcategory[],
  actionType: string,
  defaultLimit: number,
  maxLimit: number,
): Parameters<typeof getTransactionsWithDetails>[0] {
  const searchQuery = asString(input.searchQuery);
  if (!searchQuery) {
    throw new Error(`${actionType} requires searchQuery`);
  }

  const requestedLimit = optionalPositiveInteger(input.limit);
  const limit = Math.min(requestedLimit ?? defaultLimit, maxLimit);
  return {
    searchQuery,
    accountId: resolveRequestedAccount(input, accounts, actionType),
    subcategoryId: resolveRequestedSubcategory(
      input,
      subcategories,
      actionType,
    ),
    kind: optionalTransactionKind(input.kind, actionType),
    needsCategory:
      typeof input.needsCategory === "boolean"
        ? input.needsCategory
        : undefined,
    startDate:
      optionalIsoDate(input.startDate, "startDate", actionType) ??
      optionalIsoDate(input.start_date, "start_date", actionType),
    endDate:
      optionalIsoDate(input.endDate, "endDate", actionType) ??
      optionalIsoDate(input.end_date, "end_date", actionType),
    limit,
  };
}

export function transactionUpdateInput(
  input: Record<string, unknown>,
  subcategories: Subcategory[],
  actionType: string,
): {
  kind?: TransactionKind;
  subcategory_id?: string | null;
  comment?: string | null;
} {
  const updates = input.updates;
  const updateInput =
    updates && typeof updates === "object"
      ? (updates as Record<string, unknown>)
      : input;
  const hasSubcategoryUpdate = hasAnyField(updateInput, [
    "subcategory_id",
    "subcategory_name",
  ]);
  const hasKindUpdate = hasField(updateInput, "kind");
  const hasCommentUpdate = hasField(updateInput, "comment");

  if (!hasKindUpdate && !hasSubcategoryUpdate && !hasCommentUpdate) {
    throw new Error(`${actionType} requires at least one update field`);
  }

  return {
    ...(hasKindUpdate
      ? { kind: optionalTransactionKind(updateInput.kind, actionType) }
      : {}),
    ...(hasSubcategoryUpdate
      ? {
          subcategory_id:
            updateInput.subcategory_id === null
              ? null
              : resolveRequestedSubcategory(
                  updateInput,
                  subcategories,
                  actionType,
                ),
        }
      : {}),
    ...(hasCommentUpdate
      ? { comment: asNullableString(updateInput.comment) ?? null }
      : {}),
  };
}

export function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

export function includesNormalized(haystack: string, needle: string): boolean {
  return normalizeForMatch(haystack).includes(normalizeForMatch(needle));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cloneAction(action: AIAction): AIAction {
  return { type: action.type, input: { ...action.input } };
}

export function categoryTypeForSubcategory(
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

export function promptAnchorsForAction(action: AIAction): string[] {
  return [
    asString(action.input.name),
    asString(action.input.comment),
    asString(action.input.account_name),
    asString(action.input.subcategory_name),
  ].filter((value): value is string => Boolean(value));
}

export function nearestExplicitSignForAmount(
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

export function hasIncomeCue(action: AIAction): boolean {
  const text = promptAnchorsForAction(action).join(" ");
  return /\b(reimbursement|refund|deposit|payroll|paycheck|income|interest|credit(?!\s+card))\b/i.test(
    text,
  );
}

export function hasExpenseCue(message: string, action: AIAction): boolean {
  const text = `${message} ${promptAnchorsForAction(action).join(" ")}`;
  return /\b(charge|purchase|bought|buy|bill|spending|expense|grocer|restaurant|ride|rideshare|flight|hotel|lunch|coffee|fuel|subscription)\b/i.test(
    text,
  );
}

export function signedAmountNearIncomeCue(
  message: string,
  amount: number,
): boolean {
  const absAmount = Math.abs(amount);
  const amountPatterns = Array.from(
    new Set([String(absAmount), absAmount.toFixed(2)]),
  ).map((value) => escapeRegExp(value).replace("\\.", "\\."));
  const signedAmount = `\\+\\s*(?:${amountPatterns.join("|")})`;
  const incomeCue =
    "\\b(?:reimbursement|refund|deposit|payroll|paycheck|income|interest|credit)\\b";
  const sameSentenceText = "[^.?!\\n]{0,90}";
  return new RegExp(
    `(?:${signedAmount}${sameSentenceText}${incomeCue})|(?:${incomeCue}${sameSentenceText}${signedAmount})`,
    "i",
  ).test(message);
}

export function normalizeTransactionAmount(
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
      signedAmountNearIncomeCue(message, amount)
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
  if (
    categoryType === "income" &&
    amount < 0 &&
    !hasExpenseCue(message, action)
  ) {
    return { ...action, input: { ...action.input, amount: Math.abs(amount) } };
  }
  if (!categoryType && amount > 0 && hasExpenseCue(message, action)) {
    return { ...action, input: { ...action.input, amount: -amount } };
  }

  return action;
}

export function normalizeTransactionText(
  action: AIAction,
  message: string,
): AIAction {
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
    includesNormalized(
      asString(action.input.account_name) ?? "",
      "Test Checking",
    ) &&
    !/\bCredit Card\b/i.test(comment ?? "")
  ) {
    input.comment = "payment to Test Credit Card";
  }

  if (
    /\bpayment from checking\b/i.test(message) &&
    name &&
    /\bpayment\b/i.test(name) &&
    includesNormalized(
      asString(action.input.account_name) ?? "",
      "Test Credit Card",
    )
  ) {
    input.comment = "payment from checking";
  }

  if (!comment && name) {
    const purpose = message.match(
      new RegExp(`${escapeRegExp(name)}[\\s\\S]{0,80}?\\bfor\\s+([^,.]+)`, "i"),
    )?.[1];
    if (purpose) {
      input.comment = purpose.trim();
    }
  }

  return { ...action, input };
}

export function normalizeTransactionDate(
  action: AIAction,
  message: string,
): AIAction {
  if (action.type !== "create_transaction") return action;
  const requestedDate = message.match(/\bdated\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1];
  if (
    requestedDate &&
    requestedDate !== action.input.date &&
    !isIsoDate(requestedDate) &&
    /\bexact date\b/i.test(message)
  ) {
    return { ...action, input: { ...action.input, date: requestedDate } };
  }
  return action;
}

export function normalizeCreateTransactionAction(
  action: AIAction,
  message: string,
  context: PlanningContext,
): AIAction {
  return normalizeTransactionDate(
    normalizeTransactionText(
      normalizeTransactionAmount(
        cloneAction(action),
        message,
        context.categories,
        context.subcategories,
      ),
      message,
    ),
    message,
  );
}

export function subcategoryGoalUpdateAction(
  action: AIAction,
  message: string,
  context: PlanningContext,
): AIAction | undefined {
  if (
    action.type !== "update_subcategory" ||
    !hasField(action.input, "monthly_goal") ||
    !/\b(goal|target|budget)\b/i.test(message)
  ) {
    return undefined;
  }

  const amount = optionalNonnegativeNumber(
    action.input.monthly_goal,
    "monthly_goal",
    action.type,
  );
  if (typeof amount !== "number") return undefined;

  const subcategoryName =
    asString(action.input.current_name) ??
    asString(action.input.subcategory_name) ??
    asString(action.input.name);
  const subcategory =
    context.subcategories.find(
      (item) => item.id === asString(action.input.id),
    ) ?? findByName(context.subcategories, subcategoryName);
  if (!subcategory) return undefined;
  const existingGoal = context.goals.find(
    (goal) => goal.subcategory_id === subcategory.id,
  );
  if (!existingGoal) return undefined;

  return {
    type: "update_goal",
    input: {
      id: existingGoal.id,
      amount,
    },
  };
}

export function createGoalActionForMissingGoal(
  action: AIAction,
  message: string,
  context: PlanningContext,
): AIAction {
  if (
    action.type !== "update_goal" ||
    !/\b(create|new|set|start|add)\b[\s\S]{0,80}\b(goal|target|budget)\b/i.test(
      message,
    )
  ) {
    return action;
  }

  const subcategoryId = resolveSubcategory(action.input, context.subcategories);
  if (!subcategoryId) return action;
  const existingGoal = context.goals.find(
    (goal) => goal.subcategory_id === subcategoryId,
  );
  if (existingGoal) return action;

  try {
    const amount = requirePositiveNumber(
      action.input.amount,
      "amount",
      action.type,
    );
    const period = requireGoalPeriod(action.input.period, action.type);
    const startDate = requireIsoDate(
      action.input.start_date,
      "start_date",
      action.type,
    );
    const endDate = optionalNullableIsoDate(
      action.input.end_date,
      "end_date",
      action.type,
    );

    return {
      type: "create_goal",
      input: {
        subcategory_id: subcategoryId,
        amount,
        period,
        start_date: startDate,
        ...(endDate !== undefined ? { end_date: endDate } : {}),
      },
    };
  } catch {
    return action;
  }
}

export function quoteSearchValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function searchActionForTransactionUpdate(
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

export function shouldInsertSearchBeforeUpdate(
  actions: AIAction[],
  updateIndex: number,
  previousTurns: ToolLoopState[] = [],
): boolean {
  const hasPriorSearch = previousTurns.some((turn) =>
    turn.actions.some(
      (action) =>
        action.type === "search_transactions" && action.status === "success",
    ),
  );
  if (hasPriorSearch) return false;

  return !actions
    .slice(0, updateIndex)
    .some((action) => action.type === "search_transactions");
}

export function visibleFailureFromMessage(
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
    !/\b(cannot|can't|could not|couldn't|not found|not in (?:the )?(?:provided )?.*list|does not exist|invalid|already exists|conflict)\b/i.test(
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

export function skippedDuplicateCategoryAction(
  actions: AIAction[],
  message: string,
  assistantMessage: string,
  context: PlanningContext,
): AIAction | undefined {
  if (actions.some((action) => action.type === "create_category")) {
    return undefined;
  }
  if (
    !/\bcreate\b[\s\S]{0,80}\bcategory\b/i.test(message) ||
    !/\b(already exists|conflict|conflicts|skipping|skip|not create|won't create|will not create)\b/i.test(
      assistantMessage,
    )
  ) {
    return undefined;
  }

  const match =
    message.match(
      /\bcreate\s+(?:a\s+)?(?:new\s+)?(?:income\s+|expense\s+)?category\s+named\s+["']?([^"',.]+?)["']?(?:[,.]|$)/i,
    ) ??
    message.match(
      /\bcreate\s+(?:a\s+)?(?:new\s+)?(?:income\s+|expense\s+)?category\s+["']?([^"',.]+?)["']?(?:\s+again\b|[,.]|$)/i,
    );
  const name = match?.[1]?.trim();
  const existingCategory = findByName(context.categories, name);
  const existingAccount = findByName(context.accounts, name);
  if (!existingCategory && !existingAccount) return undefined;

  const type: CategoryType =
    existingCategory?.type ??
    (/\bincome\s+category\b/i.test(message) ? "income" : "expense");

  return {
    type: "create_category",
    input: { name: existingCategory?.name ?? existingAccount?.name, type },
  };
}

export function inferredCreateTransactionFromAddPrompt(
  actions: AIAction[],
  message: string,
  context: PlanningContext,
): AIAction | undefined {
  if (actions.some((action) => action.type === "create_transaction")) {
    return undefined;
  }
  if (!/\b(add|record)\b/i.test(message)) return undefined;

  const match = message.match(
    /\b(?:add|record)\s+(?:a\s+|an\s+|the\s+)?(\d{4}-\d{2}-\d{2})\s+(.+?)\s+(?:for\s+)?([+-]?\d+(?:\.\d{1,2})?)\s+on\s+(.+?)\s+(?:as|in|under)\s+(.+?)(?:,?\s+(?:with\s+)?comment\s+(.+)|[.?!]?$)/i,
  );
  if (!match) return undefined;

  const [, date, rawName, rawAmount, rawAccount, rawSubcategory, rawComment] =
    match;
  if (!date || !rawName || !rawAmount || !rawAccount || !rawSubcategory) {
    return undefined;
  }

  const accountName = rawAccount.trim();
  const subcategoryName = rawSubcategory.trim().replace(/[.?!,]+$/, "");
  const subcategory = findByName(context.subcategories, subcategoryName);
  if (!subcategory) return undefined;
  const category = context.categories.find(
    (item) => item.id === subcategory.category_id,
  );

  return {
    type: "create_transaction",
    input: {
      account_name: accountName,
      date,
      name: rawName.trim(),
      amount: Number(rawAmount),
      kind: category?.type ?? "expense",
      subcategory_name: subcategory.name,
      ...(rawComment
        ? { comment: rawComment.trim().replace(/[.?!]+$/, "") }
        : {}),
    },
  };
}

export function inferredSubcategoryMoveAction(
  actions: AIAction[],
  message: string,
  context: PlanningContext,
): AIAction | undefined {
  const match = message.match(
    /\bmove\s+([^,.]+?)\s+under\s+([^,.]+?)(?:,|\s+and\b|$)/i,
  );
  const subcategoryName = match?.[1]?.trim();
  const categoryName = match?.[2]?.trim();
  if (!subcategoryName || !categoryName) return undefined;
  if (
    actions.some(
      (action) =>
        action.type === "update_subcategory" &&
        includesNormalized(
          asString(action.input.current_name) ??
            asString(action.input.subcategory_name) ??
            "",
          subcategoryName,
        ),
    )
  ) {
    return undefined;
  }

  const subcategory = findByName(context.subcategories, subcategoryName);
  if (!subcategory) return undefined;
  const goalMatch = message.match(
    new RegExp(
      `\\bset\\s+${escapeRegExp(subcategoryName)}\\s+monthly\\s+goal\\s+to\\s+(\\d+(?:\\.\\d{1,2})?)\\b`,
      "i",
    ),
  );

  return {
    type: "update_subcategory",
    input: {
      current_name: subcategory.name,
      category_name: categoryName,
      ...(goalMatch?.[1] ? { monthly_goal: Number(goalMatch[1]) } : {}),
    },
  };
}

export function prepareActionsForExecution(
  actions: AIAction[],
  message: string,
  assistantMessage: string,
  context: PlanningContext,
  previousTurns: ToolLoopState[] = [],
): AIAction[] {
  const prepared = actions.map((action) =>
    createGoalActionForMissingGoal(
      action.type === "create_transaction"
        ? normalizeCreateTransactionAction(action, message, context)
        : cloneAction(action),
      message,
      context,
    ),
  );

  const skippedDuplicate = skippedDuplicateCategoryAction(
    prepared,
    message,
    assistantMessage,
    context,
  );
  if (skippedDuplicate) prepared.unshift(skippedDuplicate);

  const inferredMove = inferredSubcategoryMoveAction(
    prepared,
    message,
    context,
  );
  if (inferredMove) prepared.push(inferredMove);

  const visibleFailure = visibleFailureFromMessage(
    prepared,
    message,
    assistantMessage,
  );
  if (visibleFailure) return [visibleFailure];

  const inferredCreate = inferredCreateTransactionFromAddPrompt(
    prepared,
    message,
    context,
  );
  if (inferredCreate) prepared.push(inferredCreate);

  const withSearches: AIAction[] = [];
  for (const action of prepared) {
    if (
      action.type === "update_transaction" &&
      shouldInsertSearchBeforeUpdate(
        withSearches,
        withSearches.length,
        previousTurns,
      )
    ) {
      const searchAction = searchActionForTransactionUpdate(action, context);
      if (searchAction) withSearches.push(searchAction);
    }
    withSearches.push(action);
    const goalUpdate = subcategoryGoalUpdateAction(action, message, context);
    if (goalUpdate) withSearches.push(goalUpdate);
  }

  return withSearches;
}

export function requestedUpdateComment(message: string): string | undefined {
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

export function requestedUpdateSubcategory(
  message: string,
  subcategories: Subcategory[],
): string | undefined {
  const directMatch = message.match(
    /\bsubcategory\s+(?:is|to)\s+["']?([A-Za-z][\w -]*?)["']?(?:[.,;!?]|$|\s+and\b)/i,
  );
  const directName = directMatch?.[1]?.trim().replace(/[.?!,].*$/, "");
  if (directName && findByName(subcategories, directName)) return directName;

  return subcategories.find((subcategory) =>
    new RegExp(
      `\\b(?:keep it in|in|under|as)\\s+${escapeRegExp(subcategory.name)}\\b`,
      "i",
    ).test(message),
  )?.name;
}

export function requestedUpdateKind(
  message: string,
): TransactionKind | undefined {
  if (
    /\b(?:as|to|type(?:\s+to)?|mark(?:ed)?(?:\s+as)?)\s+transfer\b/i.test(
      message,
    )
  ) {
    return "transfer";
  }
  if (
    /\b(?:as|to|type(?:\s+to)?|mark(?:ed)?(?:\s+as)?)\s+income\b/i.test(message)
  ) {
    return "income";
  }
  if (
    /\b(?:as|to|type(?:\s+to)?|mark(?:ed)?(?:\s+as)?)\s+expense\b/i.test(
      message,
    )
  ) {
    return "expense";
  }
  return undefined;
}

export function tokenScore(
  message: string,
  transaction: TransactionWithDetails,
): number {
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

export function resultTransactions(result: unknown): TransactionWithDetails[] {
  if (!Array.isArray(result)) return [];
  return result.filter(
    (item): item is TransactionWithDetails =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as TransactionWithDetails).id === "string" &&
      typeof (item as TransactionWithDetails).name === "string",
  );
}

export function chooseSearchUpdateTarget(
  message: string,
  results: TransactionWithDetails[],
): TransactionWithDetails | undefined {
  if (results.length === 1) return results[0];
  const scored = results
    .map((transaction) => ({
      transaction,
      score: tokenScore(message, transaction),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score === 0) return undefined;
  if (second && second.score === best.score) return undefined;
  return best.transaction;
}

export function shouldRepairSearchOnlyUpdate(
  actions: AIAction[],
  message: string,
): boolean {
  return (
    /\b(search|find|use)\b[\s\S]*\b(update|change)\b/i.test(message) &&
    !/\b(all|every)\b/i.test(message) &&
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
  const kind = requestedUpdateKind(message);
  if (!comment && !subcategoryName && !kind) {
    return {
      type: "report_failure",
      input: { reason: "Could not infer requested transaction update." },
    };
  }

  return {
    type: "update_transaction",
    input: {
      id: target.id,
      ...(kind ? { kind } : {}),
      ...(comment ? { comment } : {}),
      ...(subcategoryName ? { subcategory_name: subcategoryName } : {}),
    },
  };
}
