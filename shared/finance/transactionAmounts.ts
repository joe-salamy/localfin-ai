import type { AccountType, TransactionKind } from "../contracts/index.js";

function roundCurrencyAmount(amount: number): number {
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(amount) + Number.EPSILON) * 100) / 100;
}

export function normalizeTransactionAmount(
  amount: number,
  accountType: AccountType,
  kind: TransactionKind,
): number {
  if (kind === "transfer" || amount === 0) {
    return roundCurrencyAmount(amount);
  }

  const absoluteAmount = Math.abs(amount);
  const sign =
    (accountType === "asset" && kind === "expense") ||
    (accountType === "liability" && kind === "income")
      ? -1
      : 1;

  return roundCurrencyAmount(absoluteAmount * sign);
}

export function inferTransactionKindForAccount(
  amount: number,
  accountType: AccountType,
): Exclude<TransactionKind, "transfer" | "adjustment"> {
  if (amount === 0) return "expense";
  if (accountType === "liability") {
    return amount > 0 ? "expense" : "income";
  }
  return amount > 0 ? "income" : "expense";
}
