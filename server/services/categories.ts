import crypto from "node:crypto";
import { getDb, toBool } from "../db/index.js";
import type {
  Category,
  CategoryType,
  Subcategory,
} from "../../src/types/index.js";

interface CategoryRow {
  id: string;
  name: string;
  type: string;
  color: string | null;
  is_system: number;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

interface SubcategoryRow {
  id: string;
  category_id: string;
  name: string;
  monthly_goal: number | null;
  color: string | null;
  is_system: number;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CategoryType,
    color: row.color,
    is_system: toBool(row.is_system),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function rowToSubcategory(row: SubcategoryRow): Subcategory {
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    monthly_goal: row.monthly_goal,
    color: row.color,
    is_system: toBool(row.is_system),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function checkNameUniqueness(
  name: string,
  excludeTable?: string,
  excludeId?: string,
): void {
  const db = getDb();

  const accountExists =
    excludeTable === "accounts" && excludeId
      ? db
          .prepare(
            "SELECT 1 FROM accounts WHERE name = ? AND deleted_at IS NULL AND id != ?",
          )
          .get(name, excludeId)
      : db
          .prepare(
            "SELECT 1 FROM accounts WHERE name = ? AND deleted_at IS NULL",
          )
          .get(name);

  if (accountExists) {
    throw new Error(`An account with the name "${name}" already exists`);
  }

  const categoryExists =
    excludeTable === "categories" && excludeId
      ? db
          .prepare(
            "SELECT 1 FROM categories WHERE name = ? AND deleted_at IS NULL AND id != ?",
          )
          .get(name, excludeId)
      : db
          .prepare(
            "SELECT 1 FROM categories WHERE name = ? AND deleted_at IS NULL",
          )
          .get(name);

  if (categoryExists) {
    throw new Error(`A category with the name "${name}" already exists`);
  }

  const subcategoryExists =
    excludeTable === "subcategories" && excludeId
      ? db
          .prepare(
            "SELECT 1 FROM subcategories WHERE name = ? AND deleted_at IS NULL AND id != ?",
          )
          .get(name, excludeId)
      : db
          .prepare(
            "SELECT 1 FROM subcategories WHERE name = ? AND deleted_at IS NULL",
          )
          .get(name);

  if (subcategoryExists) {
    throw new Error(`A subcategory with the name "${name}" already exists`);
  }
}

// === CATEGORIES ===

export function createCategory(data: {
  name: string;
  type: CategoryType;
  color?: string | null;
}): Category {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  checkNameUniqueness(data.name);

  db.prepare(
    "INSERT INTO categories (id, name, type, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, data.name, data.type, data.color ?? null, now, now);

  const row = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(id) as CategoryRow;
  return rowToCategory(row);
}

export function getCategories(): Category[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY is_system DESC, created_at",
    )
    .all() as CategoryRow[];
  return rows.map(rowToCategory);
}

export function getCategoryById(id: string): Category | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL")
    .get(id) as CategoryRow | undefined;
  return row ? rowToCategory(row) : undefined;
}

export function updateCategory(
  id: string,
  updates: { name?: string; type?: CategoryType; color?: string | null },
): Category {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL")
    .get(id) as CategoryRow | undefined;
  if (!existing) {
    throw new Error(`Category with id "${id}" not found`);
  }

  const onlyColorUpdate =
    updates.color !== undefined &&
    updates.name === undefined &&
    updates.type === undefined;

  if (toBool(existing.is_system) && !onlyColorUpdate) {
    throw new Error("Cannot update system categories");
  }

  if (updates.name !== undefined) {
    checkNameUniqueness(updates.name, "categories", id);
  }

  const name = updates.name ?? existing.name;
  const type = updates.type ?? existing.type;
  const color = updates.color !== undefined ? updates.color : existing.color;

  db.prepare(
    "UPDATE categories SET name = ?, type = ?, color = ?, updated_at = ? WHERE id = ?",
  ).run(name, type, color, now, id);

  const row = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(id) as CategoryRow;
  return rowToCategory(row);
}

export function deleteCategory(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL")
    .get(id) as CategoryRow | undefined;
  if (!existing) {
    throw new Error(`Category with id "${id}" not found`);
  }

  if (toBool(existing.is_system)) {
    throw new Error("Cannot delete system categories");
  }

  const subcategoryCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM subcategories WHERE category_id = ? AND deleted_at IS NULL",
    )
    .get(id) as { count: number };

  if (subcategoryCount.count > 0) {
    throw new Error(
      "Cannot delete category with existing subcategories. Delete all subcategories first.",
    );
  }

  db.prepare("UPDATE categories SET deleted_at = ? WHERE id = ?").run(now, id);
}

export function restoreCategory(id: string): Category {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(id) as CategoryRow | undefined;
  if (!existing || existing.deleted_at === null) {
    throw new Error(`Category with id "${id}" not found`);
  }

  const conflict = db
    .prepare(
      `SELECT 1
       FROM categories
       WHERE name = ?
         AND type = ?
         AND deleted_at IS NULL
         AND id != ?`,
    )
    .get(existing.name, existing.type, id);
  if (conflict) {
    throw new Error(
      `A category with the name "${existing.name}" and type "${existing.type}" already exists`,
    );
  }

  db.prepare(
    "UPDATE categories SET deleted_at = NULL, updated_at = ? WHERE id = ?",
  ).run(now, id);

  const row = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(id) as CategoryRow;
  return rowToCategory(row);
}

// === SUBCATEGORIES ===

export function createSubcategory(data: {
  name: string;
  category_id: string;
  monthly_goal?: number | null;
  color?: string | null;
}): Subcategory {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  checkNameUniqueness(data.name);

  const category = db
    .prepare("SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL")
    .get(data.category_id) as CategoryRow | undefined;
  if (!category) {
    throw new Error(`Category with id "${data.category_id}" not found`);
  }

  db.prepare(
    "INSERT INTO subcategories (id, category_id, name, monthly_goal, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    data.category_id,
    data.name,
    data.monthly_goal ?? null,
    data.color ?? null,
    now,
    now,
  );

  const row = db
    .prepare("SELECT * FROM subcategories WHERE id = ?")
    .get(id) as SubcategoryRow;
  return rowToSubcategory(row);
}

export function getSubcategories(): Subcategory[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM subcategories WHERE deleted_at IS NULL ORDER BY is_system DESC, created_at",
    )
    .all() as SubcategoryRow[];
  return rows.map(rowToSubcategory);
}

export function getSubcategoriesByCategory(categoryId: string): Subcategory[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM subcategories WHERE category_id = ? AND deleted_at IS NULL ORDER BY is_system DESC, created_at",
    )
    .all(categoryId) as SubcategoryRow[];
  return rows.map(rowToSubcategory);
}

export function getSubcategoryById(id: string): Subcategory | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM subcategories WHERE id = ? AND deleted_at IS NULL")
    .get(id) as SubcategoryRow | undefined;
  return row ? rowToSubcategory(row) : undefined;
}

export function updateSubcategory(
  id: string,
  updates: {
    name?: string;
    category_id?: string;
    monthly_goal?: number | null;
    color?: string | null;
  },
): Subcategory {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM subcategories WHERE id = ? AND deleted_at IS NULL")
    .get(id) as SubcategoryRow | undefined;
  if (!existing) {
    throw new Error(`Subcategory with id "${id}" not found`);
  }

  const onlyColorUpdate =
    updates.color !== undefined &&
    updates.name === undefined &&
    updates.category_id === undefined &&
    updates.monthly_goal === undefined;

  if (toBool(existing.is_system) && !onlyColorUpdate) {
    throw new Error("Cannot update system subcategories");
  }

  if (updates.name !== undefined) {
    checkNameUniqueness(updates.name, "subcategories", id);
  }

  if (updates.category_id !== undefined) {
    const category = db
      .prepare("SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL")
      .get(updates.category_id) as CategoryRow | undefined;
    if (!category) {
      throw new Error(`Category with id "${updates.category_id}" not found`);
    }
  }

  const name = updates.name ?? existing.name;
  const categoryId = updates.category_id ?? existing.category_id;
  const monthlyGoal =
    updates.monthly_goal !== undefined
      ? updates.monthly_goal
      : existing.monthly_goal;
  const color = updates.color !== undefined ? updates.color : existing.color;

  db.prepare(
    "UPDATE subcategories SET name = ?, category_id = ?, monthly_goal = ?, color = ?, updated_at = ? WHERE id = ?",
  ).run(name, categoryId, monthlyGoal, color, now, id);

  const row = db
    .prepare("SELECT * FROM subcategories WHERE id = ?")
    .get(id) as SubcategoryRow;
  return rowToSubcategory(row);
}

export function deleteSubcategory(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM subcategories WHERE id = ? AND deleted_at IS NULL")
    .get(id) as SubcategoryRow | undefined;
  if (!existing) {
    throw new Error(`Subcategory with id "${id}" not found`);
  }

  if (toBool(existing.is_system)) {
    throw new Error("Cannot delete system subcategories");
  }

  db.prepare("UPDATE subcategories SET deleted_at = ? WHERE id = ?").run(
    now,
    id,
  );
}

export function restoreSubcategory(id: string): Subcategory {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM subcategories WHERE id = ?")
    .get(id) as SubcategoryRow | undefined;
  if (!existing || existing.deleted_at === null) {
    throw new Error(`Subcategory with id "${id}" not found`);
  }

  const parent = db
    .prepare("SELECT 1 FROM categories WHERE id = ? AND deleted_at IS NULL")
    .get(existing.category_id);
  if (!parent) {
    throw new Error(`Category with id "${existing.category_id}" not found`);
  }

  const conflict = db
    .prepare(
      `SELECT 1
       FROM subcategories
       WHERE name = ?
         AND category_id = ?
         AND deleted_at IS NULL
         AND id != ?`,
    )
    .get(existing.name, existing.category_id, id);
  if (conflict) {
    throw new Error(
      `A subcategory with the name "${existing.name}" already exists in this category`,
    );
  }

  db.prepare(
    "UPDATE subcategories SET deleted_at = NULL, updated_at = ? WHERE id = ?",
  ).run(now, id);

  const row = db
    .prepare("SELECT * FROM subcategories WHERE id = ?")
    .get(id) as SubcategoryRow;
  return rowToSubcategory(row);
}
