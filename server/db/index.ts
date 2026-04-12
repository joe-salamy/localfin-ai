import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = path.resolve(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'budget.db');
  db = new Database(dbPath);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  // Seed system data
  seed(db);

  console.log(`Database initialized at ${dbPath}`);
  return db;
}

// SQLite boolean helpers
export function toBool(val: number | null | undefined): boolean {
  return val === 1;
}

export function fromBool(val: boolean): number {
  return val ? 1 : 0;
}
