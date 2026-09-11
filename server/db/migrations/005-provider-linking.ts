import type Database from "better-sqlite3";
import { addColumnIfMissing, rebuildTransactions } from "./helpers.js";

export function up(database: Database.Database): void {
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
