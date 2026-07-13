import type { Subcategory, Tag, TransactionKind, TransactionWithDetails } from "../../../shared/contracts/index.js";
import type { AIAction, PlanningContext, SearchActionResult, ToolLoopState } from "./types.js";
import { asString } from "./input-validators.js";
import { findByName } from "./entity-resolution.js";
import { escapeRegExp, normalizeForMatch } from "./transaction-action-normalization.js";

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

export function requestedUpdateTags(message: string): {
  add_tag_names?: string[];
  remove_tag_names?: string[];
  tag_type?: Tag["type"];
} {
  const tagTypeMatch = message.match(
    /\b(custom|trip|event|person|reimbursable|tax)\s+tag\b|\bfor\s+["']?([A-Za-z][\w -]*?)["']?\s+(custom|trip|event|person|reimbursable|tax)\b/i,
  );
  const tagType = (tagTypeMatch?.[1] ?? tagTypeMatch?.[3])?.toLowerCase() as
    | Tag["type"]
    | undefined;
  const typedName = tagTypeMatch?.[2]?.trim().replace(/[.?!,].*$/, "");
  const removeMatch = message.match(
    /\b(?:remove|drop)\s+tag\s+["']?([A-Za-z][\w -]*?)["']?(?:\s+(?:from|off)\b|[.,;!?]|$|\s+and\b)/i,
  );
  const addMatch = message.match(
    /\b(?:tag\s+(?:it|this|that|the transaction)?\s+as|add\s+tag|set\s+tag\s+to)\s+["']?([A-Za-z][\w -]*?)["']?(?:\s+(?:to|for|on)\b|[.,;!?]|$|\s+and\b)/i,
  );
  const removeName = removeMatch?.[1]?.trim().replace(/[.?!,].*$/, "");
  const addName = (addMatch?.[1] ?? typedName)?.trim().replace(/[.?!,].*$/, "");

  return {
    ...(addName ? { add_tag_names: [addName] } : {}),
    ...(removeName ? { remove_tag_names: [removeName] } : {}),
    ...(tagType ? { tag_type: tagType } : {}),
  };
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
  const tagUpdates = requestedUpdateTags(message);
  const hasTagUpdates =
    Boolean(tagUpdates.add_tag_names?.length) ||
    Boolean(tagUpdates.remove_tag_names?.length);
  if (!comment && !subcategoryName && !kind && !hasTagUpdates) {
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
      ...tagUpdates,
    },
  };
}
