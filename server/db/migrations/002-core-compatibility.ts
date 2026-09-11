import type Database from "better-sqlite3";
import {
  addColumnIfMissing,
  columns,
  rebuildTransactions,
} from "./helpers.js";

export function up(database: Database.Database): void {
  const hadInitialBalance = columns(database, "accounts").has("initial_balance");
  addColumnIfMissing(database, "accounts", "initial_balance REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "accounts", "color TEXT");
  addColumnIfMissing(database, "categories", "color TEXT");
  addColumnIfMissing(database, "subcategories", "color TEXT");
  addColumnIfMissing(database, "transactions", "kind TEXT NOT NULL DEFAULT 'expense'");
  addColumnIfMissing(database, "transactions", "is_initial_balance INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "transactions", "ai_suggested INTEGER NOT NULL DEFAULT 0");
  database.exec(`
    UPDATE transactions
       SET kind = CASE WHEN amount > 0 THEN 'income' ELSE 'expense' END
     WHERE kind = 'expense' AND amount > 0;
  `);
  if (!hadInitialBalance) {
    database.exec(`
      UPDATE accounts
         SET initial_balance = initial_balance + COALESCE((
           SELECT SUM(amount) FROM transactions
            WHERE account_id = accounts.id AND deleted_at IS NULL
              AND (is_initial_balance = 1 OR lower(trim(name)) = 'initial balance')
         ), 0)
       WHERE EXISTS (
         SELECT 1 FROM transactions
          WHERE account_id = accounts.id AND deleted_at IS NULL
            AND (is_initial_balance = 1 OR lower(trim(name)) = 'initial balance')
       );
      DELETE FROM transactions
       WHERE deleted_at IS NULL
         AND (is_initial_balance = 1 OR lower(trim(name)) = 'initial balance');
    `);
  }
  rebuildTransactions(database);
}
