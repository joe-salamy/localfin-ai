import crypto from "node:crypto";
import { getDb, toBool } from "../db/index.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { assertEntityNameIsUnique } from "./entity-name-uniqueness.js";
import type { Account,
AccountType,
AccountWithBalance,
ReconcileAccountResult,
Transaction, } from "../../shared/contracts/index.js"

interface AccountRow {
  id: string;
  name: string;
  type: string;
  initial_balance: number;
  color: string | null;
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

interface BalanceRow {
  balance: number | null;
}

interface TransactionRow {
  id: string;
  account_id: string;
  date: string;
  name: string;
  amount: number;
  kind: "income" | "expense" | "transfer" | "adjustment";
  subcategory_id: string | null;
  comment: string | null;
  is_initial_balance: number;
  ai_suggested: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    initial_balance: row.initial_balance,
    color: row.color,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function rowToAccountWithBalance(
  row: AccountWithBalanceRow,
): AccountWithBalance {
  return {
    ...rowToAccount(row),
    current_balance: row.current_balance ?? 0,
  };
}

function rowToTransaction(row: TransactionRow): Transaction {
  return {
    ...row,
    is_initial_balance: toBool(row.is_initial_balance),
    ai_suggested: toBool(row.ai_suggested),
  };
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function defaultAdjustmentName(account: AccountRow, amount: number): string {
  if (account.type === "liability") {
    return amount >= 0 ? "Balance Increase" : "Balance Decrease";
  }

  return amount >= 0 ? "Appreciation" : "Depreciation";
}


export function createAccount(data: {
  name: string;
  type: AccountType;
  initial_balance?: number;
  color?: string | null;
}): Account {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  assertEntityNameIsUnique(data.name);

  db.prepare(
    "INSERT INTO accounts (id, name, type, initial_balance, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    data.name,
    data.type,
    data.initial_balance ?? 0,
    data.color ?? null,
    now,
    now,
  );

  const row = db
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .get(id) as AccountRow;
  return rowToAccount(row);
}

export function getAccounts(): Account[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at",
    )
    .all() as AccountRow[];
  return rows.map(rowToAccount);
}

export function getAccountsWithBalances(): AccountWithBalance[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT a.*, a.initial_balance + COALESCE(SUM(t.amount), 0) AS current_balance
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
    GROUP BY a.id
    ORDER BY a.created_at
  `,
    )
    .all() as AccountWithBalanceRow[];
  return rows.map(rowToAccountWithBalance);
}

export function getAccountById(id: string): Account | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL")
    .get(id) as AccountRow | undefined;
  return row ? rowToAccount(row) : undefined;
}

export function updateAccount(
  id: string,
  updates: {
    name?: string;
    type?: AccountType;
    initial_balance?: number;
    color?: string | null;
  },
): Account {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL")
    .get(id) as AccountRow | undefined;
  if (!existing) {
    throw new NotFoundError(`Account with id "${id}" not found`)
  }

  if (updates.name !== undefined) {
    assertEntityNameIsUnique(updates.name, { table: "accounts", id });
  }

  const name = updates.name ?? existing.name;
  const type = updates.type ?? existing.type;
  const initialBalance = updates.initial_balance ?? existing.initial_balance;
  const color = updates.color !== undefined ? updates.color : existing.color;

  db.prepare(
    "UPDATE accounts SET name = ?, type = ?, initial_balance = ?, color = ?, updated_at = ? WHERE id = ?",
  ).run(name, type, initialBalance, color, now, id);

  const row = db
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .get(id) as AccountRow;
  return rowToAccount(row);
}

export function reconcileAccount(
  id: string,
  data: { date: string; target_balance: number; name?: string },
): ReconcileAccountResult {
  const db = getDb();
  const now = new Date().toISOString();

  return db.transaction(() => {
    const account = db
      .prepare("SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL")
      .get(id) as AccountRow | undefined;

    if (!account) {
      throw new NotFoundError(`Account with id "${id}" not found`)
    }

    const balanceRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS balance
         FROM transactions
         WHERE account_id = ? AND date <= ? AND deleted_at IS NULL`,
      )
      .get(id, data.date) as BalanceRow;

    const previousBalance = roundCurrency(
      account.initial_balance + (balanceRow.balance ?? 0),
    );
    const targetBalance = roundCurrency(data.target_balance);
    const adjustmentAmount = roundCurrency(targetBalance - previousBalance);

    if (adjustmentAmount === 0) {
      return {
        transaction: null,
        previous_balance: previousBalance,
        target_balance: targetBalance,
        adjustment_amount: 0,
      };
    }

    const transactionId = crypto.randomUUID();
    const name =
      data.name?.trim() || defaultAdjustmentName(account, adjustmentAmount);
    db.prepare(
      `INSERT INTO transactions (
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
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'adjustment', NULL, NULL, 0, 0, ?, ?)`,
    ).run(transactionId, id, data.date, name, adjustmentAmount, now, now);

    const transaction = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get(transactionId) as TransactionRow;

    return {
      transaction: rowToTransaction(transaction),
      previous_balance: previousBalance,
      target_balance: targetBalance,
      adjustment_amount: adjustmentAmount,
    };
  })();
}

export function deleteAccount(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL")
    .get(id) as AccountRow | undefined;
  if (!existing) {
    throw new NotFoundError(`Account with id "${id}" not found`)
  }

  db.prepare("UPDATE accounts SET deleted_at = ? WHERE id = ?").run(now, id);
}

export function restoreAccount(id: string): Account {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as
    | AccountRow
    | undefined;
  if (!existing || existing.deleted_at === null) {
    throw new NotFoundError(`Account with id "${id}" not found`)
  }

  const conflict = db
    .prepare(
      "SELECT 1 FROM accounts WHERE name = ? AND deleted_at IS NULL AND id != ?",
    )
    .get(existing.name, id);
  if (conflict) {
    throw new ConflictError(`An account with the name "${existing.name}" already exists`)
  }

  db.prepare(
    "UPDATE accounts SET deleted_at = NULL, updated_at = ? WHERE id = ?",
  ).run(now, id);

  const row = db
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .get(id) as AccountRow;
  return rowToAccount(row);
}

export function getAccountTransactionCount(accountId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE account_id = ? AND deleted_at IS NULL",
    )
    .get(accountId) as CountRow;
  return row.count;
}
