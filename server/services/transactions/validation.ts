import type { AccountType, CreateTransactionData, TransactionKind } from "../../../shared/contracts/index.js";
import { inferTransactionKindForAccount, normalizeTransactionAmount } from "../../../shared/finance/transactionAmounts.js";
import { getDb } from "../../db/index.js";
import { BadRequestError, NotFoundError } from "../../errors.js";

export function getActiveAccountType(accountId: string): AccountType {
  const db = getDb();
  const account = db
    .prepare("SELECT type FROM accounts WHERE id = ? AND deleted_at IS NULL")
    .get(accountId) as { type: AccountType } | undefined;
  if (!account) {
    throw new NotFoundError(`Account with id "${accountId}" not found`)
  }
  return account.type;
}

export function assertActiveSubcategory(subcategoryId: string): void {
  const db = getDb();
  const subcategory = db
    .prepare(
      `
    SELECT 1
    FROM subcategories s
    JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
    WHERE s.id = ? AND s.deleted_at IS NULL
  `,
    )
    .get(subcategoryId);

  if (!subcategory) {
    throw new NotFoundError(`Subcategory with id "${subcategoryId}" not found`)
  }
}

export function assertKindSubcategoryCompatible(
  kind: TransactionKind | undefined,
  subcategoryId: string | null | undefined,
): void {
  if (kind === undefined) return;

  if (
    (kind === "transfer" || kind === "adjustment") &&
    subcategoryId !== null &&
    subcategoryId !== undefined
  ) {
    throw new BadRequestError(
      `Transaction kind "${kind}" cannot have a subcategory`,
    );
  }

  if (
    (kind !== "income" && kind !== "expense") ||
    subcategoryId === null ||
    subcategoryId === undefined
  ) {
    return;
  }

  const db = getDb();
  const subcategory = db
    .prepare(
      `
      SELECT c.type
      FROM subcategories s
      JOIN categories c ON c.id = s.category_id
      WHERE s.id = ?
    `,
    )
    .get(subcategoryId) as { type: "income" | "expense" } | undefined;

  if (subcategory && subcategory.type !== kind) {
    throw new BadRequestError(
      `Transaction kind "${kind}" requires a "${kind}" subcategory`,
    );
  }
}

export function normalizeTransactionFields(
  data: CreateTransactionData,
  accountType: AccountType,
): CreateTransactionData & {
  kind: TransactionKind;
  subcategory_id: string | null;
} {
  const kind =
    data.kind ?? inferTransactionKindForAccount(data.amount, accountType);
  return {
    ...data,
    amount: normalizeTransactionAmount(data.amount, accountType, kind),
    kind,
    subcategory_id:
      kind === "transfer" || kind === "adjustment"
        ? null
        : (data.subcategory_id ?? null),
  };
}
