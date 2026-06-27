import type {
  Account,
  Category,
  SpendingGoalWithDetails,
  Subcategory,
} from "../../../src/types/index.js";
import { asString, hasAnyField } from "./input-validators.js";

export function findByName<T extends { name: string }>(
  items: T[],
  name?: string,
): T | undefined {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === normalized);
}

export function findAllByName<T extends { name: string }>(
  items: T[],
  name?: string,
): T[] {
  if (!name) return [];
  const normalized = name.trim().toLowerCase();
  return items.filter((item) => item.name.trim().toLowerCase() === normalized);
}

export function describeEntityCandidate(item: {
  id: string;
  name: string;
  type?: string;
  category_id?: string;
}): string {
  const details = [
    `id=${item.id}`,
    item.type ? `type=${item.type}` : undefined,
    item.category_id ? `category_id=${item.category_id}` : undefined,
  ].filter(Boolean);
  return `${item.name} (${details.join(", ")})`;
}

export function resolveEntityReference<T extends { id: string; name: string }>(
  items: T[],
  idValue: string | undefined,
  nameValue: string | undefined,
): string | undefined {
  if (idValue && items.some((item) => item.id === idValue)) return idValue;

  const idNameMatches = findAllByName(items, idValue);
  if (idNameMatches.length === 1) return idNameMatches[0]?.id;

  const nameMatches = findAllByName(items, nameValue);
  if (nameMatches.length === 1) return nameMatches[0]?.id;

  return undefined;
}

export function referenceError<T extends { id: string; name: string }>(
  actionType: string,
  label: string,
  items: T[],
  values: Array<string | undefined>,
): Error {
  const reference = values.find(Boolean);
  const matches = findAllByName(items, reference);
  if (reference && matches.length > 1) {
    return new Error(
      `${actionType} references ambiguous ${label} "${reference}". Candidates: ${matches
        .map(describeEntityCandidate)
        .join("; ")}`,
    );
  }
  return new Error(`${actionType} references an unknown ${label}`);
}

export function resolveAccount(
  input: Record<string, unknown>,
  accounts: Account[],
): string | undefined {
  return resolveEntityReference(
    accounts,
    asString(input.account_id),
    asString(input.account_name) ?? asString(input.current_name),
  );
}

export function resolveRequestedAccount(
  input: Record<string, unknown>,
  accounts: Account[],
  actionType: string,
): string | undefined {
  const accountId = resolveAccount(input, accounts);
  if (!accountId && hasAnyField(input, ["account_id", "account_name"])) {
    throw referenceError(actionType, "account", accounts, [
      asString(input.account_id),
      asString(input.account_name),
      asString(input.current_name),
    ]);
  }
  return accountId;
}

export function resolveCategory(
  input: Record<string, unknown>,
  categories: Category[],
): string | undefined {
  return resolveEntityReference(
    categories,
    asString(input.category_id),
    asString(input.category_name) ?? asString(input.current_name),
  );
}

export function resolveSubcategory(
  input: Record<string, unknown>,
  subcategories: Subcategory[],
): string | undefined {
  return resolveEntityReference(
    subcategories,
    asString(input.subcategory_id),
    asString(input.subcategory_name) ?? asString(input.current_name),
  );
}

export function resolveRequestedCategory(
  input: Record<string, unknown>,
  categories: Category[],
  actionType: string,
): string | undefined {
  const categoryId = resolveCategory(input, categories);
  if (!categoryId && hasAnyField(input, ["category_id", "category_name"])) {
    throw referenceError(actionType, "category", categories, [
      asString(input.category_id),
      asString(input.category_name),
      asString(input.current_name),
    ]);
  }
  return categoryId;
}

export function resolveRequestedSubcategory(
  input: Record<string, unknown>,
  subcategories: Subcategory[],
  actionType: string,
): string | undefined {
  const subcategoryId = resolveSubcategory(input, subcategories);
  if (
    !subcategoryId &&
    (asString(input.subcategory_id) || asString(input.subcategory_name))
  ) {
    throw referenceError(actionType, "subcategory", subcategories, [
      asString(input.subcategory_id),
      asString(input.subcategory_name),
      asString(input.current_name),
    ]);
  }
  return subcategoryId;
}

export function resolveGoal(
  input: Record<string, unknown>,
  goals: SpendingGoalWithDetails[],
  subcategories: Subcategory[],
): string | undefined {
  const id = asString(input.id);
  if (id) return id;
  const subcategoryId = resolveSubcategory(input, subcategories);
  return goals.find((goal) => goal.subcategory_id === subcategoryId)?.id;
}
