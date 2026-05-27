import type { AccountType, CategoryType, TransactionKind } from '../types';

export function accountChangeScaleValue(amount: number, accountType: AccountType): number {
  return accountType === 'liability' ? -amount : amount;
}

export function categoryDifferenceScaleValue(
  difference: number,
  categoryType: CategoryType,
): number {
  return categoryType === 'income' ? -difference : difference;
}

export function transactionAmountScaleValue(
  amount: number,
  kind: TransactionKind,
): number | null {
  if (kind === 'transfer' || kind === 'adjustment') return null;
  return kind === 'expense' ? -Math.abs(amount) : Math.abs(amount);
}

export function scaleValueColorClass(scaleValue: number): string {
  return scaleValue >= 0 ? 'text-green-400' : 'text-red-400';
}
