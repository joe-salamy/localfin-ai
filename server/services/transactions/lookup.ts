import type { TransactionKind } from "../../../shared/contracts/index.js";
import { merchantKey, merchantKeysMatch } from "../../../shared/finance/merchantNames.js";
import { getDb } from "../../db/index.js";
import { getSubcategories } from "../categories.js";
import { getRecentTransactionByNameAndAccount } from "./read.js";

export interface CategoryLookupHit {
  subcategoryId: string;
  source: "exact" | "merchant";
}

export type CategoryLookup = (
  name: string,
  accountId: string,
  kind: TransactionKind,
) => CategoryLookupHit | null;

const MERCHANT_WINDOW = 20;
const MERCHANT_MIN_SAMPLES = 3;
// Stricter than the exact-name tier (0.6): the key match is fuzzy and crosses accounts.
const MERCHANT_CONFIDENCE = 0.8;

/**
 * Deterministic subcategory reuse for new income/expense rows, in two tiers:
 * 1. exact name on the same account (`getRecentTransactionByNameAndAccount`);
 * 2. merchant key (`merchantKey`) across every account: the 20 most recent
 *    matching categorized/transfer rows, at least 3, whose majority
 *    `(kind, subcategory)` holds >= 80%.
 * A hit must have the row's kind and a live subcategory. History is
 * snapshotted when the lookup is created.
 */
export function createCategoryLookup(): CategoryLookup {
  const activeSubcategoryIds = new Set(getSubcategories().map((s) => s.id));
  const history = (
    getDb()
      .prepare(
        `
      SELECT name, kind, subcategory_id FROM transactions
      WHERE deleted_at IS NULL AND (kind = 'transfer' OR subcategory_id IS NOT NULL)
      ORDER BY date DESC, created_at DESC
    `,
      )
      .all() as Array<{ name: string; kind: TransactionKind; subcategory_id: string | null }>
  ).map((row) => ({ ...row, key: merchantKey(row.name) }));

  const usable = (
    kind: TransactionKind,
    candidate: { kind: TransactionKind; subcategory_id: string | null } | null,
  ): candidate is { kind: TransactionKind; subcategory_id: string } =>
    candidate != null &&
    candidate.kind === kind &&
    candidate.subcategory_id != null &&
    activeSubcategoryIds.has(candidate.subcategory_id);

  return (name, accountId, kind) => {
    if (kind !== "income" && kind !== "expense") return null;

    const exact = getRecentTransactionByNameAndAccount(name, accountId);
    if (usable(kind, exact)) return { subcategoryId: exact.subcategory_id, source: "exact" };

    const key = merchantKey(name);
    const window = history.filter((row) => merchantKeysMatch(key, row.key)).slice(0, MERCHANT_WINDOW);
    if (window.length < MERCHANT_MIN_SAMPLES) return null;

    const counts = new Map<string, { count: number; row: (typeof window)[number] }>();
    for (const row of window) {
      const groupKey = `${row.kind}::${row.subcategory_id ?? ""}`;
      const entry = counts.get(groupKey);
      if (entry) entry.count += 1;
      else counts.set(groupKey, { count: 1, row });
    }
    // Insertion order is recency order, so ties keep the most recent group.
    let winner: { count: number; row: (typeof window)[number] } | null = null;
    for (const entry of counts.values()) {
      if (winner === null || entry.count > winner.count) winner = entry;
    }
    if (winner === null || winner.count / window.length < MERCHANT_CONFIDENCE) return null;
    return usable(kind, winner.row) ? { subcategoryId: winner.row.subcategory_id, source: "merchant" } : null;
  };
}
