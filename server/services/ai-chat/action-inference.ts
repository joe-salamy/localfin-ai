import type { CategoryType } from "../../../shared/contracts/index.js";
import type { AIAction, PlanningContext } from "./types.js";
import { asString, hasField, optionalNonnegativeNumber, optionalNullableIsoDate, requireGoalPeriod, requireIsoDate, requirePositiveNumber } from "./input-validators.js";
import { findByName, resolveSubcategory } from "./entity-resolution.js";
import { escapeRegExp, includesNormalized } from "./transaction-action-normalization.js";

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
