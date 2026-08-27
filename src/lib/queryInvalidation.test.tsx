import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { queryKeys } from "./queryKeys";
import {
  invalidateFinanceQueries,
  type FinanceInvalidationScope,
} from "./queryInvalidation";

const ROOTS = [
  queryKeys.accounts.all,
  queryKeys.categories.all,
  queryKeys.subcategories.all,
  queryKeys.tags.all,
  queryKeys.transactions.all,
  queryKeys.accountLinking.all,
  queryKeys.dashboard.all,
] as const;

async function invalidatedRoots(scope: FinanceInvalidationScope): Promise<string[]> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const root of ROOTS) client.setQueryData(root, { seeded: true });
  await invalidateFinanceQueries(client, scope);
  return ROOTS.filter(
    (root) => client.getQueryState(root)?.isInvalidated,
  ).map((root) => String(root[0]));
}

test("category invalidation refreshes transactions and dashboard", async () => {
  await expect(invalidatedRoots("categories")).resolves.toEqual([
    "categories",
    "subcategories",
    "transactions",
    "dashboard",
  ]);
});

test.each([
  ["accounts", ["accounts", "transactions", "dashboard"]],
  ["tags", ["tags", "transactions", "dashboard"]],
  ["transactions", ["accounts", "transactions", "dashboard"]],
  ["providers", ["accounts", "transactions", "account-linking", "dashboard"]],
  [
    "all",
    [
      "accounts",
      "categories",
      "subcategories",
      "tags",
      "transactions",
      "account-linking",
      "dashboard",
    ],
  ],
] as const)("%s invalidates exactly its finance roots", async (scope, roots) => {
  expect(await invalidatedRoots(scope)).toEqual(roots);
});
test("no extra roots invalidated beyond finance scopes", async () => {
  for (const scope of [
    "accounts",
    "categories",
    "tags",
    "transactions",
    "providers",
    "all",
  ] as const) {
    const roots = await invalidatedRoots(scope);
    expect(roots.every((root) => ["accounts","categories","subcategories","tags","transactions","account-linking","dashboard"].includes(root))).toBe(true);
  }
});
