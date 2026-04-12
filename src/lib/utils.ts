import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumberWithCommas(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseNumberWithCommas(value: string): string {
  return value.replace(/,/g, '');
}

export function formatDateInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

export function parseDateInput(value: string): string {
  return value.replace(/\//g, '');
}

export function formatCurrency(amount: number): string {
  const prefix = amount < 0 ? '-$' : '$';
  return `${prefix}${formatNumberWithCommas(Math.abs(amount))}`;
}
