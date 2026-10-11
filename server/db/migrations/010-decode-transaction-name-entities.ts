import type Database from "better-sqlite3";
import { decodeHtmlEntities } from "../../../shared/finance/merchantNames.js";

// The CSV parser now decodes HTML character references (Chase exports `&` as
// `&amp;`). Stored names must match so exact-name dedup and lookup keep
// recognizing re-imported rows.
export function up(database: Database.Database): void {
  const rows = database
    .prepare("SELECT id, name FROM transactions WHERE name LIKE '%&%;%'")
    .all() as Array<{ id: string; name: string }>;
  const update = database.prepare("UPDATE transactions SET name = ? WHERE id = ?");
  for (const row of rows) {
    const decoded = decodeHtmlEntities(row.name);
    if (decoded !== row.name) update.run(decoded, row.id);
  }
}
