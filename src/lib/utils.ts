import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumberWithCommas(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseNumberWithCommas(value: string): string {
  return value.replace(/,/g, "");
}

export function formatDateInput(value: string): string {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  }

  const completeSlashMatch = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  );
  if (completeSlashMatch) {
    const month = completeSlashMatch[1].padStart(2, "0");
    const day = completeSlashMatch[2].padStart(2, "0");
    return `${month}/${day}/${completeSlashMatch[3]}`;
  }

  const slashInputMatch = trimmed.match(
    /^(\d{1,2})\/(\d{0,2})(?:\/(\d{0,4}))?$/,
  );
  if (slashInputMatch) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseDateInput(value: string): string {
  return value.replace(/\//g, "");
}

export function formatCurrency(amount: number): string {
  const prefix = amount < 0 ? "-$" : "$";
  return `${prefix}${formatNumberWithCommas(Math.abs(amount))}`;
}
