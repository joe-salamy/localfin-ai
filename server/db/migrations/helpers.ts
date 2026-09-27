import type Database from "better-sqlite3";

function tableExists(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

export function columns(database: Database.Database, tableName: string): Set<string> {
  if (!tableExists(database, tableName)) return new Set();
  return new Set(
    (
      database.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

export function addColumnIfMissing(
  database: Database.Database,
  tableName: string,
  definition: string,
): void {
  const name = definition.split(/\s+/, 1)[0];
  if (!name || columns(database, tableName).has(name)) return;
  database.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${definition}`);
}

const TRANSACTION_CORE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_subcategory ON transactions(subcategory_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_lookup ON transactions(account_id, name) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON transactions(deleted_at) WHERE deleted_at IS NULL;
`;

function dependentTransactionTables(database: Database.Database): string[] {
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return tables
    .filter(({ name }) =>
      (
        database.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
          table: string;
        }>
      ).some((foreignKey) => foreignKey.table === "transactions"),
    )
    .map(({ name }) => name);
}

function preserveTransactionDependents(database: Database.Database): string[] {
  const dependents = dependentTransactionTables(database);
  const unknown = dependents.filter(
    (name) =>
      name !== "transaction_tags" && name !== "suspect_transaction_findings",
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown tables reference transactions: ${unknown.sort().join(", ")}`,
    );
  }

  if (dependents.includes("transaction_tags")) {
    database.exec(`
      CREATE TEMP TABLE saved_transaction_tags AS
        SELECT transaction_id, tag_id, created_at FROM transaction_tags;
      DROP TABLE transaction_tags;
    `);
  }
  if (dependents.includes("suspect_transaction_findings")) {
    database.exec(`
      CREATE TEMP TABLE saved_suspect_transaction_findings AS
        SELECT id, scan_run_id, transaction_id, status, severity, score,
               reason_codes_json, evidence_json, created_at, updated_at
        FROM suspect_transaction_findings;
      DROP TABLE suspect_transaction_findings;
    `);
  }
  return dependents;
}

function restoreTransactionDependents(
  database: Database.Database,
  dependents: readonly string[],
): void {
  if (dependents.includes("transaction_tags")) {
    database.exec(`
      CREATE TABLE transaction_tags (
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (transaction_id, tag_id)
      );
      INSERT INTO transaction_tags SELECT * FROM temp.saved_transaction_tags;
      DROP TABLE temp.saved_transaction_tags;
      CREATE INDEX idx_transaction_tags_tag ON transaction_tags(tag_id);
      CREATE INDEX idx_transaction_tags_transaction ON transaction_tags(transaction_id);
    `);
  }
  if (dependents.includes("suspect_transaction_findings")) {
    database.exec(`
      CREATE TABLE suspect_transaction_findings (
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
      INSERT INTO suspect_transaction_findings
        SELECT * FROM temp.saved_suspect_transaction_findings;
      DROP TABLE temp.saved_suspect_transaction_findings;
      CREATE INDEX idx_suspect_findings_run ON suspect_transaction_findings(scan_run_id);
      CREATE INDEX idx_suspect_findings_transaction ON suspect_transaction_findings(transaction_id);
      CREATE INDEX idx_suspect_findings_status ON suspect_transaction_findings(status);
    `);
  }
}

export function rebuildTransactions(
  database: Database.Database,
  { dropProviderColumns = false }: { dropProviderColumns?: boolean } = {},
): void {
  const oldColumns = columns(database, "transactions");
  const dependents = preserveTransactionDependents(database);
  const hasProviderConnectionTable = tableExists(
    database,
    "provider_connections",
  );
  const providerColumns = [
    "provider",
    "provider_connection_id",
    "provider_account_id",
    "provider_transaction_id",
    "provider_pending_transaction_id",
    "provider_synced_at",
  ] as const;
  const includeProviderColumns =
    !dropProviderColumns && providerColumns.some((name) => oldColumns.has(name));
  const expression = (name: string, fallback: string): string =>
    oldColumns.has(name) ? name : fallback;

  database.exec(`
    ALTER TABLE transactions RENAME TO transactions_legacy_kind;
    DROP INDEX IF EXISTS idx_transactions_date;
    DROP INDEX IF EXISTS idx_transactions_account;
    DROP INDEX IF EXISTS idx_transactions_subcategory;
    DROP INDEX IF EXISTS idx_transactions_lookup;
    DROP INDEX IF EXISTS idx_transactions_deleted;
    DROP INDEX IF EXISTS idx_transactions_provider_transaction;
    DROP INDEX IF EXISTS idx_transactions_provider_connection;
  `);
  database.exec(`
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
      ${includeProviderColumns ? "provider TEXT CHECK(provider IN ('plaid', 'akoya'))," : ""}
      ${includeProviderColumns ? `provider_connection_id TEXT${hasProviderConnectionTable ? " REFERENCES provider_connections(id) ON DELETE SET NULL" : ""},` : ""}
      ${includeProviderColumns ? "provider_account_id TEXT," : ""}
      ${includeProviderColumns ? "provider_transaction_id TEXT," : ""}
      ${includeProviderColumns ? "provider_pending_transaction_id TEXT," : ""}
      ${includeProviderColumns ? "provider_synced_at TEXT," : ""}
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )
  `);

  const targetColumns = [
    "id",
    "account_id",
    "date",
    "name",
    "amount",
    "kind",
    "subcategory_id",
    "comment",
    "is_initial_balance",
    "ai_suggested",
    ...(includeProviderColumns ? providerColumns : []),
    "created_at",
    "updated_at",
    "deleted_at",
  ];
  const sourceExpressions = [
    expression("id", "NULL"),
    expression("account_id", "NULL"),
    expression("date", "date('now')"),
    expression("name", "''"),
    expression("amount", "0"),
    expression("kind", "CASE WHEN amount > 0 THEN 'income' ELSE 'expense' END"),
    expression("subcategory_id", "NULL"),
    expression("comment", "NULL"),
    expression("is_initial_balance", "0"),
    expression("ai_suggested", "0"),
    ...(includeProviderColumns
      ? providerColumns.map((name) => expression(name, "NULL"))
      : []),
    expression("created_at", "datetime('now')"),
    expression("updated_at", "datetime('now')"),
    expression("deleted_at", "NULL"),
  ];
  database.exec(`
    INSERT INTO transactions (${targetColumns.join(", ")})
      SELECT ${sourceExpressions.join(", ")} FROM transactions_legacy_kind;
    DROP TABLE transactions_legacy_kind;
    ${TRANSACTION_CORE_INDEXES}
  `);
  if (includeProviderColumns) {
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_provider_transaction
        ON transactions(provider, provider_transaction_id)
        WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL AND deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_transactions_provider_connection
        ON transactions(provider_connection_id)
        WHERE provider_connection_id IS NOT NULL;
    `);
  }
  restoreTransactionDependents(database, dependents);

  const legacyTargets = database
    .prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%transactions_legacy_kind%'")
    .all();
  if (legacyTargets.length > 0) {
    throw new Error("A foreign key still targets transactions_legacy_kind");
  }
}
