import type Database from "better-sqlite3";
import { up as up001CoreSchema } from "./migrations/001-core-schema.js";
import { up as up002CoreCompatibility } from "./migrations/002-core-compatibility.js";
import { up as up003Tags } from "./migrations/003-tags.js";
import { up as up004SuspectScans } from "./migrations/004-suspect-scans.js";
import { up as up005ProviderLinking } from "./migrations/005-provider-linking.js";
import { up as up006AgentConversationCompatibility } from "./migrations/006-agent-conversation-compatibility.js";
import { up as up007AgentApprovalReceipts } from "./migrations/007-agent-approval-receipts.js";
import { up as up008DropAgentTables } from "./migrations/008-drop-agent-tables.js";
import { up as up009DropUnusedTables } from "./migrations/009-drop-unused-tables.js";
import { up as up010DecodeTransactionNameEntities } from "./migrations/010-decode-transaction-name-entities.js";

interface Migration {
  version: number;
  name: string;
  up(database: Database.Database): void;
}

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  { version: 1, name: "core-schema", up: up001CoreSchema },
  { version: 2, name: "core-compatibility", up: up002CoreCompatibility },
  { version: 3, name: "tags", up: up003Tags },
  { version: 4, name: "suspect-scans", up: up004SuspectScans },
  { version: 5, name: "provider-linking", up: up005ProviderLinking },
  {
    version: 6,
    name: "agent-conversation-compatibility",
    up: up006AgentConversationCompatibility,
  },
  {
    version: 7,
    name: "agent-approval-receipts",
    up: up007AgentApprovalReceipts,
  },
  {
    version: 8,
    name: "drop-agent-tables",
    up: up008DropAgentTables,
  },
  { version: 9, name: "drop-unused-tables", up: up009DropUnusedTables },
  {
    version: 10,
    name: "decode-transaction-name-entities",
    up: up010DecodeTransactionNameEntities,
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
