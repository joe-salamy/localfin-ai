import type { Category, CategoryType, Subcategory } from "@shared/contracts"

type CategoryLookup = Map<string, Category>;

function formatCategoryType(
  type: CategoryType | string | null | undefined,
): string | null {
  if (type === "income") return "Income";
  if (type === "expense") return "Expense";
  return null;
}

function isUnassigned(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === "unassigned";
}

export function buildCategoryLookup(categories: Category[]): CategoryLookup {
  return new Map(categories.map((category) => [category.id, category]));
}

export function formatCategoryLabel(category: Category): string {
  const typeLabel = formatCategoryType(category.type);
  if (!isUnassigned(category.name) || !typeLabel) return category.name;
  return `${category.name} (${typeLabel})`;
}

export function formatSubcategoryLabel(
  subcategory: Subcategory,
  categoryLookup: CategoryLookup,
): string {
  const category = categoryLookup.get(subcategory.category_id);
  const typeLabel = formatCategoryType(category?.type);
  if (!isUnassigned(subcategory.name) || !typeLabel) return subcategory.name;
  return `${subcategory.name} (${typeLabel})`;
}

export function formatNullableSubcategoryLabel(
  subcategoryName: string | null | undefined,
  categoryType: CategoryType | string | null | undefined,
): string | null | undefined {
  const typeLabel = formatCategoryType(categoryType);
  if (!isUnassigned(subcategoryName) || !typeLabel) return subcategoryName;
  return `${subcategoryName} (${typeLabel})`;
}
