import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

export type FinanceInvalidationScope =
  | "accounts"
  | "categories"
  | "tags"
  | "transactions"
  | "providers"
  | "all";

const ROOTS_BY_SCOPE: Record<FinanceInvalidationScope, readonly QueryKey[]> = {
  accounts: [
    queryKeys.accounts.all,
    queryKeys.transactions.all,
    queryKeys.dashboard.all,
  ],
  categories: [
    queryKeys.categories.all,
    queryKeys.subcategories.all,
    queryKeys.transactions.all,
    queryKeys.dashboard.all,
  ],
  tags: [queryKeys.tags.all, queryKeys.transactions.all, queryKeys.dashboard.all],
  transactions: [
    queryKeys.transactions.all,
    queryKeys.accounts.all,
    queryKeys.dashboard.all,
  ],
  providers: [
    queryKeys.accountLinking.all,
    queryKeys.accounts.all,
    queryKeys.transactions.all,
    queryKeys.dashboard.all,
  ],
  all: [
    queryKeys.accounts.all,
    queryKeys.categories.all,
    queryKeys.subcategories.all,
    queryKeys.tags.all,
    queryKeys.transactions.all,
    queryKeys.accountLinking.all,
    queryKeys.dashboard.all,
  ],
};

export async function invalidateFinanceQueries(
  queryClient: QueryClient,
  scope: FinanceInvalidationScope,
): Promise<void> {
  await Promise.all(
    ROOTS_BY_SCOPE[scope].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
