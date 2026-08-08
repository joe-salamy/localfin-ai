import { getDb } from "../db/index.js";
import { ConflictError } from "../errors.js";

export type EntityNameTable =
  | "accounts"
  | "categories"
  | "subcategories";

const ENTITY_LABELS: Record<EntityNameTable, string> = {
  accounts: "account",
  categories: "category",
  subcategories: "subcategory",
};

const ENTITY_ARTICLES: Record<EntityNameTable, string> = {
  accounts: "An",
  categories: "A",
  subcategories: "A",
};

const ENTITY_NAME_QUERIES: Record<EntityNameTable, string> = {
  accounts: "SELECT 1 FROM accounts WHERE name = ? AND deleted_at IS NULL",
  categories: "SELECT 1 FROM categories WHERE name = ? AND deleted_at IS NULL",
  subcategories:
    "SELECT 1 FROM subcategories WHERE name = ? AND deleted_at IS NULL",
};

export function assertEntityNameIsUnique(
  name: string,
  exclude?: { table: EntityNameTable; id: string },
): void {
  const db = getDb();
  const tables: EntityNameTable[] = [
    "accounts",
    "categories",
    "subcategories",
  ];

  for (const table of tables) {
    const row = exclude?.table === table
      ? db
          .prepare(`${ENTITY_NAME_QUERIES[table]} AND id != ?`)
          .get(name, exclude.id)
      : db.prepare(ENTITY_NAME_QUERIES[table]).get(name);
    if (row) {
      throw new ConflictError(
        `${ENTITY_ARTICLES[table]} ${ENTITY_LABELS[table]} with the name "${name}" already exists`,
      );
    }
  }
}
