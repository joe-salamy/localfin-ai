import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seed } from './seed.js';
import { DATABASE_CONFIG } from '../config/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function resolveDatabasePath(): string {
  const explicitPath = process.env.LOCALFIN_DB_PATH?.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const configuredDataDir = process.env.LOCALFIN_DATA_DIR?.trim();
  const dataDir = configuredDataDir
    ? path.resolve(configuredDataDir)
    : DATABASE_CONFIG.dataDirectory;
  return path.join(dataDir, DATABASE_CONFIG.fileName);
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolveDatabasePath();
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = fs.readFileSync(path.resolve(__dirname, DATABASE_CONFIG.schemaFileName), 'utf-8');
  db.exec(schema);
  migrate(db);

  // Seed system data
  seed(db);

  console.log(`Database initialized at ${dbPath}`);
  return db;
}

function columnExists(database: Database.Database, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function tableExists(database: Database.Database, tableName: string): boolean {
  const row = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function addColumnIfMissing(database: Database.Database, tableName: string, columnDefinition: string): void {
  const [columnName] = columnDefinition.split(/\s+/);
  if (!columnName || columnExists(database, tableName, columnName)) return;
  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
}

function transactionKindConstraintAllowsAdjustment(database: Database.Database): boolean {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")
    .get() as { sql: string } | undefined;

  return row?.sql.includes("'adjustment'") ?? false;
}

function migrateTransactionKindConstraint(database: Database.Database): void {
  if (transactionKindConstraintAllowsAdjustment(database)) return;

  const hadTransactionTagsTable = tableExists(database, 'transaction_tags');
  if (hadTransactionTagsTable) {
    database.exec(`
      DROP TABLE IF EXISTS temp.transaction_tags_kind_migration;
      CREATE TEMP TABLE transaction_tags_kind_migration AS
        SELECT transaction_id, tag_id, created_at FROM transaction_tags;
      DROP TABLE transaction_tags;
    `);
  }

  database.exec(`
    ALTER TABLE transactions RENAME TO transactions_legacy_kind;

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL DEFAULT 'expense' CHECK(kind IN ('income', 'expense', 'transfer', 'adjustment')),
      subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
      comment TEXT,
      is_initial_balance INTEGER NOT NULL DEFAULT 0,
      ai_suggested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    INSERT INTO transactions (
      id,
      account_id,
      date,
      name,
      amount,
      kind,
      subcategory_id,
      comment,
      is_initial_balance,
      ai_suggested,
      created_at,
      updated_at,
      deleted_at
    )
    SELECT
      id,
      account_id,
      date,
      name,
      amount,
      kind,
      subcategory_id,
      comment,
      is_initial_balance,
      ai_suggested,
      created_at,
      updated_at,
      deleted_at
    FROM transactions_legacy_kind;

    DROP TABLE transactions_legacy_kind;

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_subcategory ON transactions(subcategory_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_lookup ON transactions(account_id, name) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON transactions(deleted_at) WHERE deleted_at IS NULL;
  `);

  if (hadTransactionTagsTable) {
    database.exec(`
      CREATE TABLE transaction_tags (
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (transaction_id, tag_id)
      );
      INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, created_at)
        SELECT transaction_id, tag_id, created_at FROM temp.transaction_tags_kind_migration;
      DROP TABLE temp.transaction_tags_kind_migration;
      CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag ON transaction_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_tags_transaction ON transaction_tags(transaction_id);
    `);
  }
}

function absorbInitialBalanceTransactions(database: Database.Database): void {
  database.transaction(() => {
    database.exec(`
      UPDATE accounts
      SET initial_balance = initial_balance + COALESCE((
        SELECT SUM(t.amount)
        FROM transactions t
        WHERE t.account_id = accounts.id
          AND t.deleted_at IS NULL
          AND (t.is_initial_balance = 1 OR lower(trim(t.name)) = 'initial balance')
      ), 0)
      WHERE EXISTS (
        SELECT 1
        FROM transactions t
        WHERE t.account_id = accounts.id
          AND t.deleted_at IS NULL
          AND (t.is_initial_balance = 1 OR lower(trim(t.name)) = 'initial balance')
      )
    `);

    database.exec(`
      DELETE FROM transactions
      WHERE deleted_at IS NULL
        AND (is_initial_balance = 1 OR lower(trim(name)) = 'initial balance')
    `);
  })();
}

function ensureTagTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom' CHECK(type IN ('custom', 'trip', 'event', 'person', 'reimbursable', 'tax')),
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_type ON tags(lower(trim(name)), type) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(type) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS transaction_tags (
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (transaction_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag ON transaction_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_tags_transaction ON transaction_tags(transaction_id);
  `);
}

function ensureSuspectScanTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS suspect_scan_runs (
      id TEXT PRIMARY KEY,
      filters_json TEXT NOT NULL,
      total_scanned INTEGER NOT NULL DEFAULT 0,
      total_findings INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_suspect_scan_runs_created ON suspect_scan_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS suspect_transaction_findings (
      id TEXT PRIMARY KEY,
      scan_run_id TEXT NOT NULL REFERENCES suspect_scan_runs(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'dismissed', 'resolved')),
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high')),
      score REAL NOT NULL,
      reason_codes_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_suspect_findings_run ON suspect_transaction_findings(scan_run_id);
    CREATE INDEX IF NOT EXISTS idx_suspect_findings_transaction ON suspect_transaction_findings(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_suspect_findings_status ON suspect_transaction_findings(status);
  `);
}

function migrate(database: Database.Database): void {
  const hadInitialBalanceColumn = columnExists(database, 'accounts', 'initial_balance');
  addColumnIfMissing(database, 'accounts', 'initial_balance REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'accounts', 'color TEXT');
  addColumnIfMissing(database, 'categories', 'color TEXT');
  addColumnIfMissing(database, 'subcategories', 'color TEXT');
  addColumnIfMissing(database, 'transactions', "kind TEXT NOT NULL DEFAULT 'expense' CHECK(kind IN ('income', 'expense', 'transfer', 'adjustment'))");
  addColumnIfMissing(database, 'transactions', 'is_initial_balance INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'transactions', 'ai_suggested INTEGER NOT NULL DEFAULT 0');
  migrateTransactionKindConstraint(database);
  database.exec(`
    UPDATE transactions
    SET kind = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END
    WHERE kind = 'expense' AND amount >= 0
  `);
  if (!hadInitialBalanceColumn) {
    absorbInitialBalanceTransactions(database);
  }
  ensureTagTables(database);
  ensureSuspectScanTables(database);
}

export function closeDbForTests(): void {
  if (!db) return;
  db.close();
  db = null;
}

// SQLite boolean helpers
export function toBool(val: number | null | undefined): boolean {
  return val === 1;
}

export function fromBool(val: boolean): number {
  return val ? 1 : 0;
}
