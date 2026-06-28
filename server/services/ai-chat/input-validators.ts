import type {
  AccountType,
  CategoryType,
  GoalPeriod,
  TagType,
  TransactionKind,
} from "../../../src/types/index.js";

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return asString(value);
}

export function hasField(
  input: Record<string, unknown>,
  field: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

export function hasAnyField(
  input: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.some((field) => hasField(input, field));
}

export function requireAccountType(
  value: unknown,
  actionType: string,
): AccountType {
  if (value === "asset" || value === "liability") return value;
  throw new Error(`${actionType} requires type asset|liability`);
}

export function optionalAccountType(
  value: unknown,
  actionType: string,
): AccountType | undefined {
  if (value === undefined) return undefined;
  return requireAccountType(value, actionType);
}

export function requireCategoryType(
  value: unknown,
  actionType: string,
): CategoryType {
  if (value === "income" || value === "expense") return value;
  throw new Error(`${actionType} requires type income|expense`);
}

export function optionalCategoryType(
  value: unknown,
  actionType: string,
): CategoryType | undefined {
  if (value === undefined) return undefined;
  return requireCategoryType(value, actionType);
}
export function requireTagType(value: unknown, actionType: string): TagType {
  if (
    value === "custom" ||
    value === "trip" ||
    value === "event" ||
    value === "person" ||
    value === "reimbursable" ||
    value === "tax"
  ) {
    return value;
  }
  throw new Error(
    `${actionType} requires tag type custom|trip|event|person|reimbursable|tax`,
  );
}

export function optionalTagType(
  value: unknown,
  actionType: string,
): TagType | undefined {
  if (value === undefined) return undefined;
  return requireTagType(value, actionType);
}

export function normalizeStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of values) {
    const text = asString(item)?.replace(/\s+/g, " ");
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(text);
  }

  return normalized;
}

export function requireTransactionKind(
  value: unknown,
  actionType: string,
): TransactionKind {
  if (
    value === "income" ||
    value === "expense" ||
    value === "transfer" ||
    value === "adjustment"
  ) {
    return value;
  }
  throw new Error(
    `${actionType} requires kind income|expense|transfer|adjustment`,
  );
}

export function optionalTransactionKind(
  value: unknown,
  actionType: string,
): TransactionKind | undefined {
  if (value === undefined) return undefined;
  return requireTransactionKind(value, actionType);
}

export function requireGoalPeriod(
  value: unknown,
  actionType: string,
): GoalPeriod {
  if (
    value === "weekly" ||
    value === "monthly" ||
    value === "quarterly" ||
    value === "annual"
  ) {
    return value;
  }
  throw new Error(
    `${actionType} requires period weekly|monthly|quarterly|annual`,
  );
}

export function optionalGoalPeriod(
  value: unknown,
  actionType: string,
): GoalPeriod | undefined {
  if (value === undefined) return undefined;
  return requireGoalPeriod(value, actionType);
}

export function requirePositiveNumber(
  value: unknown,
  field: string,
  actionType: string,
): number {
  const numberValue = asNumber(value);
  if (numberValue === undefined || numberValue <= 0) {
    throw new Error(`${actionType} requires positive ${field}`);
  }
  return numberValue;
}

export function optionalPositiveNumber(
  value: unknown,
  field: string,
  actionType: string,
): number | undefined {
  if (value === undefined) return undefined;
  return requirePositiveNumber(value, field, actionType);
}

export function optionalNonnegativeNumber(
  value: unknown,
  field: string,
  actionType: string,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const numberValue = asNumber(value);
  if (numberValue === undefined || numberValue < 0) {
    throw new Error(`${actionType} requires nonnegative ${field}`);
  }
  return numberValue;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function requireIsoDate(
  value: unknown,
  field: string,
  actionType: string,
): string {
  const date = asString(value);
  if (!date || !isIsoDate(date)) {
    throw new Error(`${actionType} requires ${field} in YYYY-MM-DD format`);
  }
  return date;
}

export function optionalIsoDate(
  value: unknown,
  field: string,
  actionType: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requireIsoDate(value, field, actionType);
}

export function optionalNullableIsoDate(
  value: unknown,
  field: string,
  actionType: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireIsoDate(value, field, actionType);
}

export function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const numberValue = asNumber(value);
  if (numberValue === undefined) return undefined;
  const integerValue = Math.trunc(numberValue);
  return integerValue > 0 ? integerValue : undefined;
}

export function assertDateRange(
  startDate: string,
  endDate: string | null | undefined,
  actionType: string,
): void {
  if (endDate && startDate > endDate) {
    throw new Error(`${actionType} requires start_date on or before end_date`);
  }
}
