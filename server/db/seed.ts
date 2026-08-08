import type Database from "better-sqlite3";

type SystemCategoryType = "income" | "expense";

interface SystemRow {
  categoryId: string;
  subcategoryId: string;
  type: SystemCategoryType;
}

interface CategoryRecord {
  id: string;
  name: string;
  type: SystemCategoryType;
  deleted_at: string | null;
}

interface SubcategoryRecord {
  id: string;
  category_id: string;
  name: string;
  deleted_at: string | null;
}

const SYSTEM_ROWS: SystemRow[] = [
  {
    categoryId: "00000000-0000-0000-0000-000000000001",
    subcategoryId: "00000000-0000-0000-0000-000000000003",
    type: "income",
  },
  {
    categoryId: "00000000-0000-0000-0000-000000000002",
    subcategoryId: "00000000-0000-0000-0000-000000000004",
    type: "expense",
  },
];

function nextTemporaryCategoryName(
  db: Database.Database,
  type: SystemCategoryType,
  excludeId: string,
): string {
  let suffix = 0;
  while (true) {
    const name =
      suffix === 0
        ? `${type}_unassigned_seed_tmp`
        : `${type}_unassigned_seed_tmp_${suffix}`;
    const conflict = db
      .prepare(
        "SELECT 1 FROM categories WHERE name = ? AND type = ? AND deleted_at IS NULL AND id != ?",
      )
      .get(name, type, excludeId);
    if (!conflict) return name;
    suffix += 1;
  }
}

function nextTemporarySubcategoryName(
  db: Database.Database,
  categoryId: string,
  excludeId: string,
): string {
  let suffix = 0;
  while (true) {
    const name =
      suffix === 0
        ? "Unassigned_seed_tmp"
        : `Unassigned_seed_tmp_${suffix}`;
    const conflict = db
      .prepare(
        "SELECT 1 FROM subcategories WHERE name = ? AND category_id = ? AND deleted_at IS NULL AND id != ?",
      )
      .get(name, categoryId, excludeId);
    if (!conflict) return name;
    suffix += 1;
  }
}

function reconcileSystemPair(
  db: Database.Database,
  systemRow: SystemRow,
): void {
  const now = new Date().toISOString();
  const legacyCategories = db
    .prepare(
      `SELECT id
       FROM categories
       WHERE name = 'Unassigned'
         AND type = ?
         AND deleted_at IS NULL
         AND id != ?`,
    )
    .all(systemRow.type, systemRow.categoryId) as Array<{ id: string }>;

  let fixedCategory = db
    .prepare("SELECT id, name, type, deleted_at FROM categories WHERE id = ?")
    .get(systemRow.categoryId) as CategoryRecord | undefined;
  const temporaryCategoryName = nextTemporaryCategoryName(
    db,
    systemRow.type,
    systemRow.categoryId,
  );

  if (!fixedCategory) {
    db.prepare(
      `INSERT INTO categories
       (id, name, type, is_system, created_at, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`,
    ).run(systemRow.categoryId, temporaryCategoryName, systemRow.type);
    fixedCategory = {
      id: systemRow.categoryId,
      name: temporaryCategoryName,
      type: systemRow.type,
      deleted_at: null,
    };
  } else if (
    fixedCategory.name !== "Unassigned" ||
    fixedCategory.type !== systemRow.type ||
    fixedCategory.deleted_at !== null ||
    legacyCategories.length > 0
  ) {
    db.prepare(
      `UPDATE categories
       SET name = ?, type = ?, is_system = 1,
           deleted_at = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(temporaryCategoryName, systemRow.type, systemRow.categoryId);
    fixedCategory = {
      ...fixedCategory,
      name: temporaryCategoryName,
      type: systemRow.type,
      deleted_at: null,
    };
  }

  const fixedSubcategory = db
    .prepare(
      "SELECT id, category_id, name, deleted_at FROM subcategories WHERE id = ?",
    )
    .get(systemRow.subcategoryId) as SubcategoryRecord | undefined;
  if (
    fixedSubcategory &&
    legacyCategories.length > 0 &&
    fixedSubcategory.category_id === systemRow.categoryId &&
    fixedSubcategory.deleted_at === null
  ) {
    db.prepare(
      "UPDATE subcategories SET name = ?, updated_at = ? WHERE id = ?",
    ).run(
      nextTemporarySubcategoryName(
        db,
        systemRow.categoryId,
        systemRow.subcategoryId,
      ),
      now,
      systemRow.subcategoryId,
    );
  }

  for (const legacyCategory of legacyCategories) {
    const legacySubcategories = db
      .prepare(
        "SELECT id, name FROM subcategories WHERE category_id = ? AND deleted_at IS NULL",
      )
      .all(legacyCategory.id) as Array<{ id: string; name: string }>;
    for (const subcategory of legacySubcategories) {
      // A same-named active subcategory may already exist under the fixed
      // category (e.g. from an older migration state). The unique
      // (name, category_id) index would reject a plain repoint, so merge the
      // legacy row's children into the existing row and retire the legacy row.
      const existing = db
        .prepare(
          `SELECT id FROM subcategories
            WHERE category_id = ? AND name = ? AND deleted_at IS NULL AND id != ?`,
        )
        .get(systemRow.categoryId, subcategory.name, subcategory.id) as
        | { id: string }
        | undefined;
      if (existing) {
        db.prepare(
          "UPDATE transactions SET subcategory_id = ? WHERE subcategory_id = ?",
        ).run(existing.id, subcategory.id);
        db.prepare(
          "UPDATE spending_goals SET subcategory_id = ? WHERE subcategory_id = ?",
        ).run(existing.id, subcategory.id);
        db.prepare(
          "UPDATE subcategories SET deleted_at = ?, updated_at = ? WHERE id = ?",
        ).run(now, now, subcategory.id);
      } else {
        db.prepare(
          "UPDATE subcategories SET category_id = ? WHERE id = ?",
        ).run(systemRow.categoryId, subcategory.id);
      }
    }
    db.prepare("UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ?").run(
      now,
      now,
      legacyCategory.id,
    );
  }

  db.prepare(
    `UPDATE categories
     SET name = 'Unassigned', type = ?, is_system = 1,
         deleted_at = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(systemRow.type, now, systemRow.categoryId);

  let fixedSubcategoryAfterRepoint = db
    .prepare(
      "SELECT id, category_id, name, deleted_at FROM subcategories WHERE id = ?",
    )
    .get(systemRow.subcategoryId) as SubcategoryRecord | undefined;
  if (!fixedSubcategoryAfterRepoint) {
    const temporarySubcategoryName = nextTemporarySubcategoryName(
      db,
      systemRow.categoryId,
      systemRow.subcategoryId,
    );
    db.prepare(
      `INSERT INTO subcategories
       (id, category_id, name, is_system, created_at, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`,
    ).run(
      systemRow.subcategoryId,
      systemRow.categoryId,
      temporarySubcategoryName,
    );
    fixedSubcategoryAfterRepoint = {
      id: systemRow.subcategoryId,
      category_id: systemRow.categoryId,
      name: temporarySubcategoryName,
      deleted_at: null,
    };
  } else if (
    fixedSubcategoryAfterRepoint.category_id !== systemRow.categoryId ||
    fixedSubcategoryAfterRepoint.deleted_at !== null
  ) {
    db.prepare(
      `UPDATE subcategories
       SET category_id = ?, name = ?, is_system = 1,
           deleted_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      systemRow.categoryId,
      nextTemporarySubcategoryName(
        db,
        systemRow.categoryId,
        systemRow.subcategoryId,
      ),
      now,
      systemRow.subcategoryId,
    );
  }

  const legacySubcategories = db
    .prepare(
      `SELECT id
       FROM subcategories
       WHERE name = 'Unassigned'
         AND category_id = ?
         AND deleted_at IS NULL
         AND id != ?`,
    )
    .all(systemRow.categoryId, systemRow.subcategoryId) as Array<{ id: string }>;

  for (const legacySubcategory of legacySubcategories) {
    db.prepare(
      "UPDATE transactions SET subcategory_id = ? WHERE subcategory_id = ?",
    ).run(systemRow.subcategoryId, legacySubcategory.id);
    db.prepare(
      "UPDATE spending_goals SET subcategory_id = ? WHERE subcategory_id = ?",
    ).run(systemRow.subcategoryId, legacySubcategory.id);
    db.prepare(
      "UPDATE subcategories SET deleted_at = ?, updated_at = ? WHERE id = ?",
    ).run(now, now, legacySubcategory.id);
  }

  db.prepare(
    `UPDATE subcategories
     SET category_id = ?, name = 'Unassigned', is_system = 1,
         deleted_at = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(systemRow.categoryId, now, systemRow.subcategoryId);
}

export function seed(db: Database.Database): void {
  for (const systemRow of SYSTEM_ROWS) {
    db.transaction(() => {
      reconcileSystemPair(db, systemRow);
    })();
  }
}
