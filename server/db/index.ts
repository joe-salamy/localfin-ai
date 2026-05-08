import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seed } from './seed.js';
import { DATABASE_CONFIG } from '../config/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function resolveDatabasePath(): string {
  const explicitPath = process.env.LOCALFIN_DB_PATH?.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const configuredDataDir = process.env.LOCALFIN_DATA_DIR?.trim();
  const dataDir = configuredDataDir
    ? path.resolve(configuredDataDir)
    : DATABASE_CONFIG.dataDirectory;
  return path.join(dataDir, DATABASE_CONFIG.fileName);
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolveDatabasePath();
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = fs.readFileSync(path.resolve(__dirname, DATABASE_CONFIG.schemaFileName), 'utf-8');
  db.exec(schema);
  migrate(db);

  // Seed system data
  seed(db);

  console.log(`Database initialized at ${dbPath}`);
  return db;
}

function columnExists(database: Database.Database, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function addColumnIfMissing(database: Database.Database, tableName: string, columnDefinition: string): void {
  const [columnName] = columnDefinition.split(/\s+/);
  if (!columnName || columnExists(database, tableName, columnName)) return;
  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
}

function migrate(database: Database.Database): void {
  addColumnIfMissing(database, 'accounts', 'color TEXT');
  addColumnIfMissing(database, 'categories', 'color TEXT');
  addColumnIfMissing(database, 'subcategories', 'color TEXT');
}

export function closeDbForTests(): void {
  if (!db) return;
  db.close();
  db = null;
}

// SQLite boolean helpers
export function toBool(val: number | null | undefined): boolean {
  return val === 1;
}

export function fromBool(val: boolean): number {
  return val ? 1 : 0;
}
