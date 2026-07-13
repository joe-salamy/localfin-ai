import type { Account, Category, CategoryType, Subcategory, Tag } from "../../../shared/contracts/index.js";
import type { getTransactionsWithDetails } from "../transactions.js";
import { asString, optionalIsoDate, optionalPositiveInteger, normalizeStringList, optionalTransactionKind } from "./input-validators.js";
import { resolveRequestedAccount, resolveRequestedSubcategory, resolveRequestedTag, resolveSubcategory } from "./entity-resolution.js";

export function transactionSearchFilters(
  input: Record<string, unknown>,
  accounts: Account[],
  subcategories: Subcategory[],
  tags: Tag[],
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
  const tagIds = [
    ...normalizeStringList(input.tag_ids),
    ...normalizeStringList(input.tag_id),
    ...normalizeStringList(input.tagIds),
    ...normalizeStringList(input.tagId),
    ...normalizeStringList(input.tags),
  ];
  const tagNames = [
    ...normalizeStringList(input.tag_names),
    ...normalizeStringList(input.tag_name),
  ];
  const resolvedTagIds = [
    ...tagIds,
    ...tagNames.map((name) =>
      resolveRequestedTag(
        { tag_name: name, tag_type: input.tag_type },
        tags,
        actionType,
      ),
    ),
  ].filter((id): id is string => Boolean(id));
  return {
    searchQuery,
    accountId: resolveRequestedAccount(input, accounts, actionType),
    subcategoryId: resolveRequestedSubcategory(
      input,
      subcategories,
      actionType,
    ),
    tagIds: resolvedTagIds.length > 0 ? resolvedTagIds : undefined,
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
