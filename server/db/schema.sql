-- accounts
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset', 'liability')),
  initial_balance REAL NOT NULL DEFAULT 0,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name) WHERE deleted_at IS NULL;

-- provider account linking
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
  ON provider_accounts(connection_id, provider_account_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_provider_accounts_local_account
  ON provider_accounts(local_account_id)
  WHERE deleted_at IS NULL;

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

-- categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  color TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name ON categories(name, type) WHERE deleted_at IS NULL;

-- subcategories
CREATE TABLE IF NOT EXISTS subcategories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  monthly_goal REAL,
  color TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subcategories_name ON subcategories(name, category_id) WHERE deleted_at IS NULL;

-- tags
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

-- transactions
CREATE TABLE IF NOT EXISTS transactions (
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
  provider TEXT CHECK(provider IN ('plaid', 'akoya')),
  provider_connection_id TEXT REFERENCES provider_connections(id) ON DELETE SET NULL,
  provider_account_id TEXT,
  provider_transaction_id TEXT,
  provider_pending_transaction_id TEXT,
  provider_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_subcategory ON transactions(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_transactions_lookup ON transactions(account_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON transactions(deleted_at) WHERE deleted_at IS NULL;

-- suspect transaction review
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

-- spending_goals
CREATE TABLE IF NOT EXISTS spending_goals (
  id TEXT PRIMARY KEY,
  subcategory_id TEXT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK(amount > 0),
  period TEXT NOT NULL CHECK(period IN ('weekly', 'monthly', 'quarterly', 'annual')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- agent conversations
CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  current_page TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_updated ON agent_conversations(updated_at DESC) WHERE deleted_at IS NULL;

-- agent messages
CREATE TABLE IF NOT EXISTS agent_messages (
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
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id, created_at ASC);
