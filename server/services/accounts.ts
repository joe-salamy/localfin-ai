import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import type { Account, AccountType, AccountWithBalance } from '../../src/types/index.js';

interface AccountRow {
  id: string;
  name: string;
  type: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface AccountWithBalanceRow extends AccountRow {
  current_balance: number | null;
}

interface CountRow {
  count: number;
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function rowToAccountWithBalance(row: AccountWithBalanceRow): AccountWithBalance {
  return {
    ...rowToAccount(row),
    current_balance: row.current_balance ?? 0,
  };
}

function checkNameUniqueness(name: string, excludeId?: string): void {
  const db = getDb();

  const accountExists = excludeId
    ? db.prepare('SELECT 1 FROM accounts WHERE name = ? AND deleted_at IS NULL AND id != ?').get(name, excludeId)
    : db.prepare('SELECT 1 FROM accounts WHERE name = ? AND deleted_at IS NULL').get(name);

  if (accountExists) {
    throw new Error(`An account with the name "${name}" already exists`);
  }

  const categoryExists = db.prepare('SELECT 1 FROM categories WHERE name = ? AND deleted_at IS NULL').get(name);
  if (categoryExists) {
    throw new Error(`A category with the name "${name}" already exists`);
  }

  const subcategoryExists = db.prepare('SELECT 1 FROM subcategories WHERE name = ? AND deleted_at IS NULL').get(name);
  if (subcategoryExists) {
    throw new Error(`A subcategory with the name "${name}" already exists`);
  }
}

export function createAccount(data: { name: string; type: AccountType; initial_balance?: number }): Account {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  checkNameUniqueness(data.name);

  const insertAccount = db.prepare(
    'INSERT INTO accounts (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );

  const createTransaction = db.transaction(() => {
    insertAccount.run(id, data.name, data.type, now, now);

    const balance = data.initial_balance ?? 0;
    if (balance !== 0) {
      const txnId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO transactions (id, account_id, date, name, amount, is_initial_balance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(txnId, id, now.split('T')[0], 'Initial Balance', balance, now, now);
    }
  });

  createTransaction();

  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow;
  return rowToAccount(row);
}

export function getAccounts(): Account[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at'
  ).all() as AccountRow[];
  return rows.map(rowToAccount);
}

export function getAccountsWithBalances(): AccountWithBalance[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT a.*, COALESCE(SUM(t.amount), 0) AS current_balance
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
    GROUP BY a.id
    ORDER BY a.created_at
  `).all() as AccountWithBalanceRow[];
  return rows.map(rowToAccountWithBalance);
}

export function getAccountById(id: string): Account | undefined {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL'
  ).get(id) as AccountRow | undefined;
  return row ? rowToAccount(row) : undefined;
}

export function updateAccount(id: string, updates: { name?: string; type?: AccountType }): Account {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL').get(id) as AccountRow | undefined;
  if (!existing) {
    throw new Error(`Account with id "${id}" not found`);
  }

  if (updates.name !== undefined) {
    checkNameUniqueness(updates.name, id);
  }

  const name = updates.name ?? existing.name;
  const type = updates.type ?? existing.type;

  db.prepare(
    'UPDATE accounts SET name = ?, type = ?, updated_at = ? WHERE id = ?'
  ).run(name, type, now, id);

  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow;
  return rowToAccount(row);
}

export function deleteAccount(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL').get(id) as AccountRow | undefined;
  if (!existing) {
    throw new Error(`Account with id "${id}" not found`);
  }

  db.prepare('UPDATE accounts SET deleted_at = ? WHERE id = ?').run(now, id);
}

export function getAccountTransactionCount(accountId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND deleted_at IS NULL'
  ).get(accountId) as CountRow;
  return row.count;
}
