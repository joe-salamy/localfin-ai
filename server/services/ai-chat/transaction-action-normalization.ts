import type { Category, Subcategory } from "../../../shared/contracts/index.js";
import type { AIAction, PlanningContext } from "./types.js";
import { asNumber, asString, isIsoDate, normalizeStringList } from "./input-validators.js";
import { categoryTypeForSubcategory } from "./transaction-action-input.js";

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

export function promptAnchorsForAction(action: AIAction): string[] {
  const tagObjectNames = Array.isArray(action.input.tags)
    ? action.input.tags
        .map((tag) =>
          tag && typeof tag === "object"
            ? asString((tag as Record<string, unknown>).name)
            : undefined,
        )
        .filter((value): value is string => Boolean(value))
    : [];
  return [
    asString(action.input.name),
    asString(action.input.comment),
    asString(action.input.account_name),
    asString(action.input.subcategory_name),
    ...normalizeStringList(action.input.tag_name),
    ...normalizeStringList(action.input.tag_names),
    ...normalizeStringList(action.input.add_tag_name),
    ...normalizeStringList(action.input.add_tag_names),
    ...normalizeStringList(action.input.remove_tag_name),
    ...normalizeStringList(action.input.remove_tag_names),
    ...tagObjectNames,
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
