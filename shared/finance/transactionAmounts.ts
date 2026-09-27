import type { AccountType, TransactionKind } from "../contracts/index.js";

export function roundCurrencyAmount(amount: number): number {
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

/**
 * Stored amounts are signed per account: a positive asset amount adds money,
 * a positive liability amount adds debt. The net-worth effect puts both on
 * one scale so amounts from different account types can be compared or summed.
 */
export function netWorthEffect(amount: number, accountType: AccountType): number {
  return accountType === "liability" ? -amount : amount;
}
