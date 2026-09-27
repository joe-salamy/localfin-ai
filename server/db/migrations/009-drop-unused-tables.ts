import type Database from "better-sqlite3";
import { rebuildTransactions } from "./helpers.js";

// Removes schema that no code reads or writes: bank-provider linking (never
// shipped), app_meta, and spending_goals (superseded by
// subcategories.monthly_goal).
export function up(database: Database.Database): void {
  // Rebuild first so transactions no longer references provider_connections.
  rebuildTransactions(database, { dropProviderColumns: true });
  database.exec(`
    DROP TABLE IF EXISTS provider_accounts;
    DROP TABLE IF EXISTS provider_oauth_states;
    DROP TABLE IF EXISTS provider_connections;
    DROP TABLE IF EXISTS app_meta;
    DROP TABLE IF EXISTS spending_goals;
  `);
}
