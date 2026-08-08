import type {
  Account,
  Category,
  SpendingGoalWithDetails,
  Subcategory,
  Tag,
  TagType,
  TransactionKind,
} from "../../../shared/contracts/index.js";

export interface EntityReference {
  id?: string;
  name?: string;
}

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
  reference: EntityReference,
): string | undefined {
  if (reference.id && items.some((item) => item.id === reference.id)) {
    return reference.id;
  }

  const nameMatches = findAllByName(items, reference.name);
  return nameMatches.length === 1 ? nameMatches[0]?.id : undefined;
}

export function resolveRequestedEntityReference<
  T extends { id: string; name: string },
>(
  actionType: string,
  label: string,
  items: T[],
  reference: EntityReference,
): string | undefined {
  if (reference.id === undefined && reference.name === undefined) {
    return undefined;
  }

  const resolved = resolveEntityReference(items, reference);
  if (resolved) return resolved;

  const referenceValue = reference.name ?? reference.id ?? "";
  const matches = findAllByName(items, referenceValue);
  if (matches.length > 1) {
    throw new Error(
      `${actionType} references ambiguous ${label} "${referenceValue}". Candidates: ${matches
        .map(describeEntityCandidate)
        .join("; ")}`,
    );
  }
  throw new Error(`${actionType} references an unknown ${label}`);
}

export function resolveAccount(
  reference: EntityReference,
  accounts: Account[],
): string | undefined {
  return resolveEntityReference(accounts, reference);
}

export function resolveRequestedAccount(
  reference: EntityReference,
  accounts: Account[],
  actionType: string,
): string | undefined {
  return resolveRequestedEntityReference(actionType, "account", accounts, reference);
}

export function resolveCategory(
  reference: EntityReference,
  categories: Category[],
): string | undefined {
  return resolveEntityReference(categories, reference);
}

export function resolveRequestedCategory(
  reference: EntityReference,
  categories: Category[],
  actionType: string,
): string | undefined {
  return resolveRequestedEntityReference(
    actionType,
    "category",
    categories,
    reference,
  );
}

export function resolveSubcategory(
  reference: EntityReference,
  subcategories: Subcategory[],
): string | undefined {
  return resolveEntityReference(subcategories, reference);
}

/**
 * Narrows subcategories to those whose parent category type matches the
 * transaction kind, so name-based resolution of system rows like "Unassigned"
 * (which exists once per income/expense type) is unambiguous. Returns the
 * full list when the kind is not income/expense (no narrowing possible).
 */
export function subcategoriesForKind(
  subcategories: Subcategory[],
  categories: Category[],
  kind: TransactionKind | undefined,
): Subcategory[] {
  if (kind !== "income" && kind !== "expense") return subcategories;
  return subcategories.filter((subcategory) =>
    categories.some(
      (category) =>
        category.id === subcategory.category_id && category.type === kind,
    ),
  );
}

export function resolveRequestedSubcategory(
  reference: EntityReference,
  subcategories: Subcategory[],
  actionType: string,
): string | undefined {
  return resolveRequestedEntityReference(
    actionType,
    "subcategory",
    subcategories,
    reference,
  );
}

export function resolveTag(
  reference: EntityReference,
  tags: Tag[],
  requestedType?: TagType,
): string | undefined {
  const candidates = requestedType
    ? tags.filter((tag) => tag.type === requestedType)
    : tags;
  return resolveEntityReference(candidates, reference);
}

export function resolveRequestedTag(
  reference: EntityReference,
  tags: Tag[],
  actionType: string,
  requestedType?: TagType,
): string | undefined {
  return resolveRequestedEntityReference(
    actionType,
    "tag",
    requestedType ? tags.filter((tag) => tag.type === requestedType) : tags,
    reference,
  );
}

export function resolveGoal(
  reference: { id?: string; subcategory_id?: string; subcategory_name?: string },
  goals: SpendingGoalWithDetails[],
  subcategories: Subcategory[],
): string | undefined {
  if (reference.id) return reference.id;
  const subcategoryId = resolveSubcategory(
    {
      id: reference.subcategory_id,
      name: reference.subcategory_name,
    },
    subcategories,
  );
  return goals.find((goal) => goal.subcategory_id === subcategoryId)?.id;
}
