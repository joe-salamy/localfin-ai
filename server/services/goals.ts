import crypto from 'node:crypto';
import {
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { getDb } from '../db/index.js';
import type {
  CreateSpendingGoalData,
  GoalPeriod,
  SpendingGoal,
  SpendingGoalWithDetails,
} from '../../src/types/index.js';

// === Row types for query results ===

interface SpendingGoalRow {
  id: string;
  subcategory_id: string;
  amount: number;
  period: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface SpendingGoalWithDetailsRow extends SpendingGoalRow {
  subcategory_name: string;
  category_name: string;
  category_type: string;
}

interface SpentRow {
  spent: number;
}

function rowToGoal(row: SpendingGoalRow): SpendingGoal {
  return {
    id: row.id,
    subcategory_id: row.subcategory_id,
    amount: row.amount,
    period: row.period as GoalPeriod,
    start_date: row.start_date,
    end_date: row.end_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function rowToGoalWithDetails(row: SpendingGoalWithDetailsRow): SpendingGoalWithDetails {
  return {
    ...rowToGoal(row),
    subcategory_name: row.subcategory_name,
    category_name: row.category_name,
    category_type: row.category_type as 'income' | 'expense',
  };
}

function getPeriodBoundaries(
  period: GoalPeriod,
  referenceDate: Date,
): { periodStart: string; periodEnd: string } {
  let start: Date;
  let end: Date;

  switch (period) {
    case 'weekly':
      start = startOfWeek(referenceDate, { weekStartsOn: 0 });
      end = endOfWeek(referenceDate, { weekStartsOn: 0 });
      break;
    case 'monthly':
      start = startOfMonth(referenceDate);
      end = endOfMonth(referenceDate);
      break;
    case 'quarterly':
      start = startOfQuarter(referenceDate);
      end = endOfQuarter(referenceDate);
      break;
    case 'annual':
      start = startOfYear(referenceDate);
      end = endOfYear(referenceDate);
      break;
  }

  return {
    periodStart: format(start, 'yyyy-MM-dd'),
    periodEnd: format(end, 'yyyy-MM-dd'),
  };
}

function assertActiveSubcategory(subcategoryId: string): void {
  const db = getDb();
  const subcategory = db.prepare(`
    SELECT 1
    FROM subcategories s
    JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
    WHERE s.id = ? AND s.deleted_at IS NULL
  `).get(subcategoryId);

  if (!subcategory) {
    throw new Error(`Subcategory with id "${subcategoryId}" not found`);
  }
}

// === Goal Functions ===

export function createSpendingGoal(data: CreateSpendingGoalData): SpendingGoal {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  assertActiveSubcategory(data.subcategory_id);

  // Enforce one goal per subcategory
  const existing = db.prepare(
    `SELECT 1 FROM spending_goals
     WHERE subcategory_id = ? AND deleted_at IS NULL`,
  ).get(data.subcategory_id);

  if (existing) {
    throw new Error('A spending goal already exists for this subcategory');
  }

  db.prepare(
    `INSERT INTO spending_goals (id, subcategory_id, amount, period, start_date, end_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.subcategory_id, data.amount, data.period, data.start_date, data.end_date ?? null, now, now);

  const row = db.prepare('SELECT * FROM spending_goals WHERE id = ?').get(id) as SpendingGoalRow;
  return rowToGoal(row);
}

export function getSpendingGoals(): SpendingGoal[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT g.*
     FROM spending_goals g
     JOIN subcategories s ON g.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     WHERE g.deleted_at IS NULL
     ORDER BY g.created_at DESC`,
  ).all() as SpendingGoalRow[];
  return rows.map(rowToGoal);
}

export function getSpendingGoalsWithDetails(): SpendingGoalWithDetails[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT g.*, s.name AS subcategory_name, c.name AS category_name, c.type AS category_type
     FROM spending_goals g
     JOIN subcategories s ON g.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     WHERE g.deleted_at IS NULL
     ORDER BY g.created_at DESC`,
  ).all() as SpendingGoalWithDetailsRow[];
  return rows.map(rowToGoalWithDetails);
}

export function getSpendingGoalById(id: string): SpendingGoal | undefined {
  const db = getDb();
  const row = db.prepare(
    `SELECT g.*
     FROM spending_goals g
     JOIN subcategories s ON g.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     WHERE g.id = ? AND g.deleted_at IS NULL`,
  ).get(id) as SpendingGoalRow | undefined;
  return row ? rowToGoal(row) : undefined;
}

export function updateSpendingGoal(
  id: string,
  updates: { amount?: number; period?: GoalPeriod; start_date?: string; end_date?: string | null },
): SpendingGoal {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare(
    `SELECT g.*
     FROM spending_goals g
     JOIN subcategories s ON g.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     WHERE g.id = ? AND g.deleted_at IS NULL`,
  ).get(id) as SpendingGoalRow | undefined;

  if (!existing) {
    throw new Error(`Spending goal with id "${id}" not found`);
  }

  const amount = updates.amount ?? existing.amount;
  const period = updates.period ?? existing.period;
  const startDate = updates.start_date ?? existing.start_date;
  const endDate = updates.end_date !== undefined ? updates.end_date : existing.end_date;

  db.prepare(
    `UPDATE spending_goals SET amount = ?, period = ?, start_date = ?, end_date = ?, updated_at = ? WHERE id = ?`,
  ).run(amount, period, startDate, endDate, now, id);

  const row = db.prepare('SELECT * FROM spending_goals WHERE id = ?').get(id) as SpendingGoalRow;
  return rowToGoal(row);
}

export function deleteSpendingGoal(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare(
    `SELECT * FROM spending_goals WHERE id = ? AND deleted_at IS NULL`,
  ).get(id) as SpendingGoalRow | undefined;

  if (!existing) {
    throw new Error(`Spending goal with id "${id}" not found`);
  }

  db.prepare('UPDATE spending_goals SET deleted_at = ? WHERE id = ?').run(now, id);
}

export function getSpendingProgress(
  goalId: string,
  referenceDate?: string,
): { spent: number; remaining: number; percentUsed: number } {
  const db = getDb();

  const goal = db.prepare(
    `SELECT g.*
     FROM spending_goals g
     JOIN subcategories s ON g.subcategory_id = s.id AND s.deleted_at IS NULL
     JOIN categories c ON s.category_id = c.id AND c.deleted_at IS NULL
     WHERE g.id = ? AND g.deleted_at IS NULL`,
  ).get(goalId) as SpendingGoalRow | undefined;

  if (!goal) {
    throw new Error(`Spending goal with id "${goalId}" not found`);
  }

  const refDate = referenceDate ? parseISO(referenceDate) : new Date();
  const { periodStart, periodEnd } = getPeriodBoundaries(goal.period as GoalPeriod, refDate);

  // Sum absolute value of spending for the subcategory in the period
  const row = db.prepare(
    `SELECT COALESCE(SUM(ABS(t.amount)), 0) AS spent
     FROM transactions t
     WHERE t.subcategory_id = ?
       AND t.date >= ? AND t.date <= ?
       AND t.deleted_at IS NULL`,
  ).get(goal.subcategory_id, periodStart, periodEnd) as SpentRow;

  const spent = row.spent;
  const remaining = Math.max(0, goal.amount - spent);
  const percentUsed = goal.amount > 0 ? (spent / goal.amount) * 100 : 0;

  return { spent, remaining, percentUsed };
}
