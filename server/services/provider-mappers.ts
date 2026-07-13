import crypto from "node:crypto";
import type { AccountType } from "../../shared/contracts/index.js"
import { inferTransactionKindForAccount } from "../../shared/finance/transactionAmounts.js"

export interface PlaidTransaction {
  transaction_id?: string | null;
  pending_transaction_id?: string | null;
  account_id?: string | null;
  date?: string | null;
  authorized_date?: string | null;
  name?: string | null;
  merchant_name?: string | null;
  original_description?: string | null;
  amount?: number | null;
}

export interface AkoyaTransaction {
  transactionId?: string | null;
  transaction_id?: string | null;
  id?: string | null;
  accountId?: string | null;
  account_id?: string | null;
  transactionTimestamp?: string | null;
  postedTimestamp?: string | null;
  date?: string | null;
  merchantName?: string | null;
  merchant_name?: string | null;
  name?: string | null;
  description?: string | null;
  memo?: string | null;
  amount?: number | string | null;
  transactionAmount?: number | string | null;
  debitCreditMemo?: string | null;
  debit_credit_memo?: string | null;
  type?: string | null;
}

export interface ProviderTransactionDraft {
  provider: "plaid" | "akoya";
  provider_account_id: string;
  provider_transaction_id: string;
  provider_pending_transaction_id: string | null;
  date: string;
  name: string;
  amount: number;
  kind: "income" | "expense";
  comment: string | null;
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function toIsoDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function toFiniteNumber(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return numberValue;
}

function fallbackProviderTransactionId(input: {
  provider: "plaid" | "akoya";
  providerAccountId: string;
  date: string;
  name: string;
  amount: number;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      `${input.provider}:${input.providerAccountId}:${input.date}:${input.name}:${input.amount}`,
    )
    .digest("hex");
}

export function mapPlaidAccountTypeToLocal(
  type: string | null | undefined,
): AccountType {
  const normalized = type?.trim().toLowerCase();
  return normalized === "credit" || normalized === "loan"
    ? "liability"
    : "asset";
}

export function mapAkoyaAccountTypeToLocal(
  categoryOrType: string | null | undefined,
): AccountType {
  const normalized = categoryOrType?.trim().toLowerCase() ?? "";
  if (
    normalized.includes("loan") ||
    normalized.includes("loc") ||
    normalized.includes("lineofcredit") ||
    normalized.includes("line_of_credit") ||
    normalized.includes("line-of-credit") ||
    normalized.includes("creditcard") ||
    normalized.includes("credit_card") ||
    normalized.includes("credit-card") ||
    normalized.includes("liability")
  ) {
    return "liability";
  }
  return "asset";
}

export function mapPlaidTransactionToLocal(input: {
  transaction: PlaidTransaction;
  accountType: AccountType;
}): ProviderTransactionDraft {
  const providerAccountId =
    firstNonEmpty(input.transaction.account_id) ?? "unknown-plaid-account";
  const date = toIsoDate(
    input.transaction.date ?? input.transaction.authorized_date,
  );
  const name =
    firstNonEmpty(
      input.transaction.merchant_name,
      input.transaction.name,
      input.transaction.original_description,
    ) ?? "Provider transaction";
  const plaidAmount = toFiniteNumber(input.transaction.amount);
  const amount = roundCurrency(
    input.accountType === "asset" ? -plaidAmount : plaidAmount,
  );
  const transactionId =
    firstNonEmpty(input.transaction.transaction_id) ??
    fallbackProviderTransactionId({
      provider: "plaid",
      providerAccountId,
      date,
      name,
      amount,
    });

  return {
    provider: "plaid",
    provider_account_id: providerAccountId,
    provider_transaction_id: transactionId,
    provider_pending_transaction_id:
      firstNonEmpty(input.transaction.pending_transaction_id) ?? null,
    date,
    name,
    amount,
    kind: inferTransactionKindForAccount(amount, input.accountType),
    comment: null,
  };
}

export function mapAkoyaTransactionToLocal(input: {
  transaction: AkoyaTransaction;
  accountType: AccountType;
  providerAccountId: string;
}): ProviderTransactionDraft {
  const providerAccountId = input.providerAccountId;
  const date = toIsoDate(
    input.transaction.postedTimestamp ??
      input.transaction.transactionTimestamp ??
      input.transaction.date,
  );
  const name =
    firstNonEmpty(
      input.transaction.merchantName,
      input.transaction.merchant_name,
      input.transaction.name,
      input.transaction.description,
      input.transaction.memo,
    ) ?? "Provider transaction";
  const rawAmount = Math.abs(
    toFiniteNumber(
      input.transaction.amount ?? input.transaction.transactionAmount,
    ),
  );
  const signedAmount = toFiniteNumber(
    input.transaction.amount ?? input.transaction.transactionAmount,
  );
  const memo = firstNonEmpty(
    input.transaction.debitCreditMemo,
    input.transaction.debit_credit_memo,
    input.transaction.type,
  )?.toUpperCase();

  let amount: number;
  if (memo === "DEBIT") {
    amount = input.accountType === "asset" ? -rawAmount : rawAmount;
  } else if (memo === "CREDIT") {
    amount = input.accountType === "asset" ? rawAmount : -rawAmount;
  } else {
    amount = input.accountType === "asset" ? -signedAmount : signedAmount;
  }
  amount = roundCurrency(amount);

  const transactionId =
    firstNonEmpty(
      input.transaction.transactionId,
      input.transaction.transaction_id,
      input.transaction.id,
    ) ??
    fallbackProviderTransactionId({
      provider: "akoya",
      providerAccountId,
      date,
      name,
      amount,
    });

  return {
    provider: "akoya",
    provider_account_id: providerAccountId,
    provider_transaction_id: transactionId,
    provider_pending_transaction_id: null,
    date,
    name,
    amount,
    kind: inferTransactionKindForAccount(amount, input.accountType),
    comment: null,
  };
}
