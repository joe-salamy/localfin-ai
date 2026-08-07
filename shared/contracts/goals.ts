import { z } from "zod";
import type { CategoryType } from "./categories.js";

export type GoalPeriod = "weekly" | "monthly" | "quarterly" | "annual";
export const goalPeriodSchema = z.enum([
  "weekly",
  "monthly",
  "quarterly",
  "annual",
]);
export interface SpendingGoal {
  id: string;
  subcategory_id: string;
  amount: number;
  period: GoalPeriod;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SpendingGoalWithDetails extends SpendingGoal {
  subcategory_name: string;
  category_name: string;
  category_type: CategoryType;
}

export interface CreateSpendingGoalData {
  subcategory_id: string;
  amount: number;
  period: GoalPeriod;
  start_date: string;
  end_date?: string | null;
}
