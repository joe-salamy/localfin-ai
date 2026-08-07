import type {
  Account,
  Category,
  CategoryType,
  Subcategory,
  Tag,
  TransactionKind,
} from "../../../shared/contracts/index.js";
import type { getTransactionsWithDetails } from "../transactions.js";
import {
  resolveRequestedAccount,
  resolveRequestedSubcategory,
  resolveRequestedTag,
  resolveSubcategory,
} from "./entity-resolution.js";

export interface TransactionSearchInput {
  searchQuery: string;
  account_id?: string;
  account_name?: string;
  kind?: TransactionKind;
  needsCategory?: boolean;
  subcategory_id?: string;
  subcategory_name?: string;
  tag_id?: string;
  tag_name?: string;
  tag_ids?: string[];
  tag_names?: string[];
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export function transactionSearchFilters(
  input: TransactionSearchInput,
  accounts: Account[],
  subcategories: Subcategory[],
  tags: Tag[],
  actionType: string,
  defaultLimit: number,
  maxLimit: number,
): Parameters<typeof getTransactionsWithDetails>[0] {
  const tagIds = [
    ...(input.tag_ids ?? []),
    ...(input.tag_id ? [input.tag_id] : []),
  ];
  const tagNames = [
    ...(input.tag_names ?? []),
    ...(input.tag_name ? [input.tag_name] : []),
  ];
  const resolvedTagIds = [
    ...tagIds,
    ...tagNames.map((name) =>
      resolveRequestedTag({ name }, tags, actionType),
    ),
  ].filter((id): id is string => Boolean(id));

  return {
    searchQuery: input.searchQuery,
    accountId: resolveRequestedAccount(
      { id: input.account_id, name: input.account_name },
      accounts,
      actionType,
    ),
    subcategoryId: resolveRequestedSubcategory(
      { id: input.subcategory_id, name: input.subcategory_name },
      subcategories,
      actionType,
    ),
    tagIds: resolvedTagIds.length > 0 ? [...new Set(resolvedTagIds)] : undefined,
    kind: input.kind,
    needsCategory: input.needsCategory,
    startDate: input.startDate,
    endDate: input.endDate,
    limit: Math.min(input.limit ?? defaultLimit, maxLimit),
  };
}

export function categoryTypeForSubcategory(
  input: { subcategory_id?: string; subcategory_name?: string },
  categories: Category[],
  subcategories: Subcategory[],
): CategoryType | undefined {
  const subcategoryId = resolveSubcategory(
    { id: input.subcategory_id, name: input.subcategory_name },
    subcategories,
  );
  if (!subcategoryId) return undefined;
  const subcategory = subcategories.find((item) => item.id === subcategoryId);
  if (!subcategory) return undefined;
  return categories.find((category) => category.id === subcategory.category_id)
    ?.type;
}
