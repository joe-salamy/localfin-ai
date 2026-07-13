import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { DATABASE_CONFIG } from "../config/app.js";

export interface Migration {
  version: number;
  name: string;
  up(database: Database.Database): void;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tableExists(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function columns(database: Database.Database, tableName: string): Set<string> {
  if (!tableExists(database, tableName)) return new Set();
  return new Set(
    (
      database.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

function addColumnIfMissing(
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

function rebuildTransactions(database: Database.Database): void {
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
  const includeProviderColumns = providerColumns.some((name) =>
    oldColumns.has(name),
  );
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
    expression("kind", "CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END"),
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

function migrateCoreCompatibility(database: Database.Database): void {
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
       SET kind = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END
     WHERE kind = 'expense' AND amount >= 0;
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

function createTags(database: Database.Database): void {
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

function createSuspectScans(database: Database.Database): void {
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

function createProviderLinking(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS provider_connections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK(provider IN ('plaid', 'akoya')),
      target_institution TEXT NOT NULL CHECK(target_institution IN ('us_bank', 'discover', 'fidelity')),
      institution_id TEXT,
      institution_name TEXT NOT NULL,
      external_item_id TEXT,
      akoya_provider_id TEXT,
      akoya_connector TEXT,
      encrypted_access_token TEXT NOT NULL,
      access_token_iv TEXT NOT NULL,
      access_token_tag TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      refresh_token_iv TEXT,
      refresh_token_tag TEXT,
      transactions_cursor TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'needs_reauth', 'error', 'revoked')),
      last_sync_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_provider_connections_provider ON provider_connections(provider) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_provider_connections_status ON provider_connections(status) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_connections_external_item
      ON provider_connections(provider, external_item_id)
      WHERE external_item_id IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS provider_accounts (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
      local_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      provider_account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      official_name TEXT,
      mask TEXT,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability')),
      provider_type TEXT,
      provider_subtype TEXT,
      current_balance REAL,
      available_balance REAL,
      iso_currency_code TEXT,
      last_balance_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_accounts_connection_external
      ON provider_accounts(connection_id, provider_account_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_provider_accounts_local_account
      ON provider_accounts(local_account_id) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS provider_oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK(provider IN ('akoya')),
      target_institution TEXT NOT NULL CHECK(target_institution IN ('fidelity')),
      redirect_after TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_expires ON provider_oauth_states(expires_at);
  `);
  for (const definition of [
    "provider TEXT CHECK(provider IN ('plaid', 'akoya'))",
    "provider_connection_id TEXT",
    "provider_account_id TEXT",
    "provider_transaction_id TEXT",
    "provider_pending_transaction_id TEXT",
    "provider_synced_at TEXT",
  ]) {
    addColumnIfMissing(database, "transactions", definition);
  }
  rebuildTransactions(database);
}

function migrateAgentConversations(database: Database.Database): void {
  const conversationColumns = columns(database, "agent_conversations");
  const messageColumns = columns(database, "agent_messages");
  const value = (set: Set<string>, name: string, fallback: string): string =>
    set.has(name) ? name : fallback;
  database.exec(`
    ALTER TABLE agent_conversations RENAME TO agent_conversations_legacy;
    ALTER TABLE agent_messages RENAME TO agent_messages_legacy;
    DROP INDEX IF EXISTS idx_agent_conversations_updated;
    DROP INDEX IF EXISTS idx_agent_messages_conversation;
  `);
  database.exec(`
    CREATE TABLE agent_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      current_page TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    INSERT INTO agent_conversations (id, title, current_page, created_at, updated_at, deleted_at)
      SELECT id, COALESCE(${value(conversationColumns, "title", "NULL")}, 'New conversation'),
             ${value(conversationColumns, "current_page", "NULL")},
             COALESCE(${value(conversationColumns, "created_at", "NULL")}, datetime('now')),
             COALESCE(${value(conversationColumns, "updated_at", "NULL")}, datetime('now')), NULL
        FROM agent_conversations_legacy
       WHERE ${conversationColumns.has("deleted_at") ? "deleted_at IS NULL" : "1 = 1"};
    CREATE INDEX idx_agent_conversations_updated ON agent_conversations(updated_at DESC) WHERE deleted_at IS NULL;
    CREATE TABLE agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      request_id TEXT,
      actions_json TEXT,
      log_file TEXT,
      status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success', 'partial', 'error')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO agent_messages (id, conversation_id, role, content, request_id, actions_json, log_file, status, created_at)
      SELECT id, conversation_id,
             CASE WHEN ${value(messageColumns, "role", "'assistant'")} IN ('user', 'assistant') THEN ${value(messageColumns, "role", "'assistant'")} ELSE 'assistant' END,
             COALESCE(${value(messageColumns, "content", "NULL")}, ''),
             ${value(messageColumns, "request_id", "NULL")},
             ${value(messageColumns, "actions_json", "NULL")},
             ${value(messageColumns, "log_file", "NULL")},
             CASE WHEN ${value(messageColumns, "status", "'success'")} IN ('success', 'partial', 'error') THEN ${value(messageColumns, "status", "'success'")} ELSE 'success' END,
             COALESCE(${value(messageColumns, "created_at", "NULL")}, datetime('now'))
        FROM agent_messages_legacy
       WHERE conversation_id IN (SELECT id FROM agent_conversations)
         AND ${messageColumns.has("deleted_at") ? "deleted_at IS NULL" : "1 = 1"};
    CREATE INDEX idx_agent_messages_conversation ON agent_messages(conversation_id, created_at ASC);
    DROP TABLE agent_messages_legacy;
    DROP TABLE agent_conversations_legacy;
  `);
}

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    version: 1,
    name: "core-schema",
    up(database) {
      database.exec(
        fs.readFileSync(
          path.resolve(__dirname, DATABASE_CONFIG.baselineSchemaFileName),
          "utf8",
        ),
      );
    },
  },
  { version: 2, name: "core-compatibility", up: migrateCoreCompatibility },
  { version: 3, name: "tags", up: createTags },
  { version: 4, name: "suspect-scans", up: createSuspectScans },
  { version: 5, name: "provider-linking", up: createProviderLinking },
  {
    version: 6,
    name: "agent-conversation-compatibility",
    up: migrateAgentConversations,
  },
]);

export function runMigrations(
  database: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
): void {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const applied = database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number; name: string }>;
    const registeredByVersion = new Map(
      migrations.map((migration) => [migration.version, migration]),
    );
    for (const [index, row] of applied.entries()) {
      if (row.version !== index + 1) {
        throw new Error(`Schema migration version gap before ${row.version}`);
      }
      const registered = registeredByVersion.get(row.version);
      if (!registered) {
        throw new Error(`Unknown future schema migration version ${row.version}`);
      }
      if (registered.name !== row.name) {
        throw new Error(
          `Schema migration ${row.version} name mismatch: expected ${registered.name}, found ${row.name}`,
        );
      }
    }
    const appliedVersions = new Set(applied.map((row) => row.version));
    const insert = database.prepare(
      "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
    );
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      const expectedVersion = appliedVersions.size + 1;
      if (migration.version !== expectedVersion) {
        throw new Error(
          `Schema migration registry gap: expected ${expectedVersion}, found ${migration.version}`,
        );
      }
      migration.up(database);
      insert.run(migration.version, migration.name);
      appliedVersions.add(migration.version);
    }
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      throw new Error("Database migration left foreign key violations");
    }
  })();
}
