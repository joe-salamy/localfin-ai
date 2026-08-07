import { z } from "zod";
import type { Transaction } from "./transactions.js";

export type AccountType = "asset" | "liability";
export const accountTypeSchema = z.enum(["asset", "liability"]);

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
  color: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AccountWithBalance extends Account {
  current_balance: number;
}

export interface CreateAccountData {
  name: string;
  type: AccountType;
  initial_balance?: number;
  color?: string | null;
}

export interface ReconcileAccountData {
  date: string;
  target_balance: number;
  name?: string;
}

export interface ReconcileAccountResult {
  transaction: Transaction | null;
  previous_balance: number;
  target_balance: number;
  adjustment_amount: number;
}
