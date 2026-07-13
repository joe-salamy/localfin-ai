export type CategoryType = "income" | "expense";

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface Subcategory {
  id: string;
  category_id: string;
  name: string;
  monthly_goal: number | null;
  color: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface CreateCategoryData {
  name: string;
  type: CategoryType;
  color?: string | null;
}

export interface CreateSubcategoryData {
  name: string;
  category_id: string;
  monthly_goal?: number | null;
  color?: string | null;
}
