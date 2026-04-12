import crypto from 'node:crypto';
import { getDb } from '../db/index.js';

interface AICorrection {
  id: string;
  transaction_name: string;
  account_id: string;
  ai_suggested_subcategory_id: string | null;
  user_corrected_subcategory_id: string;
  created_at: string;
}

interface SaveAICorrectionData {
  transaction_name: string;
  account_id: string;
  ai_suggested_subcategory_id?: string | null;
  user_corrected_subcategory_id: string;
}

export function saveAICorrection(data: SaveAICorrectionData): AICorrection {
  const db = getDb();
  const normalizedName = data.transaction_name.trim().toLowerCase();

  const existing = db.prepare(
    'SELECT id FROM ai_corrections WHERE account_id = ? AND transaction_name = ?'
  ).get(data.account_id, normalizedName) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE ai_corrections SET ai_suggested_subcategory_id = ?, user_corrected_subcategory_id = ? WHERE id = ?'
    ).run(
      data.ai_suggested_subcategory_id ?? null,
      data.user_corrected_subcategory_id,
      existing.id,
    );

    return db.prepare('SELECT * FROM ai_corrections WHERE id = ?').get(existing.id) as AICorrection;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO ai_corrections (id, transaction_name, account_id, ai_suggested_subcategory_id, user_corrected_subcategory_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    normalizedName,
    data.account_id,
    data.ai_suggested_subcategory_id ?? null,
    data.user_corrected_subcategory_id,
  );

  return db.prepare('SELECT * FROM ai_corrections WHERE id = ?').get(id) as AICorrection;
}

export function getAICorrection(transactionName: string, accountId: string): AICorrection | null {
  const db = getDb();
  const normalizedName = transactionName.trim().toLowerCase();

  const row = db.prepare(
    'SELECT * FROM ai_corrections WHERE account_id = ? AND transaction_name = ?'
  ).get(accountId, normalizedName) as AICorrection | undefined;

  return row ?? null;
}

export function getAICorrections(): AICorrection[] {
  const db = getDb();
  return db.prepare('SELECT * FROM ai_corrections ORDER BY created_at DESC').all() as AICorrection[];
}
