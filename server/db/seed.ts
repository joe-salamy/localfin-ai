import type Database from 'better-sqlite3';

export function seed(db: Database.Database): void {
  const insertCategory = db.prepare(
    `INSERT OR IGNORE INTO categories (id, name, type, is_system, created_at)
     VALUES (?, ?, ?, 1, datetime('now'))`
  );

  const insertSubcategory = db.prepare(
    `INSERT OR IGNORE INTO subcategories (id, category_id, name, is_system, created_at)
     VALUES (?, ?, ?, 1, datetime('now'))`
  );

  db.transaction(() => {
    // System categories
    insertCategory.run('00000000-0000-0000-0000-000000000001', 'Unassigned', 'income');
    insertCategory.run('00000000-0000-0000-0000-000000000002', 'Unassigned', 'expense');

    // System subcategories
    insertSubcategory.run('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Unassigned');
    insertSubcategory.run('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'Unassigned');
  })();
}
