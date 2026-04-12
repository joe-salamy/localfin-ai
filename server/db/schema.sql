-- accounts
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset', 'liability')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name) WHERE deleted_at IS NULL;

-- categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
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
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subcategories_name ON subcategories(name, category_id) WHERE deleted_at IS NULL;

-- transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
  comment TEXT,
  is_initial_balance INTEGER NOT NULL DEFAULT 0,
  ai_suggested INTEGER NOT NULL DEFAULT 0,
  user_corrected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_subcategory ON transactions(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_transactions_lookup ON transactions(account_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON transactions(deleted_at) WHERE deleted_at IS NULL;

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

-- ai_corrections
CREATE TABLE IF NOT EXISTS ai_corrections (
  id TEXT PRIMARY KEY,
  transaction_name TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_suggested_subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
  user_corrected_subcategory_id TEXT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_corrections_lookup ON ai_corrections(account_id, transaction_name);
