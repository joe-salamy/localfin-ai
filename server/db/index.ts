import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seed } from "./seed.js";
import { runMigrations } from "./migrations.js";
import { DATABASE_CONFIG } from "../config/app.js";

let db: Database.Database | null = null;

export function resolveDatabasePath(): string {
  const explicitPath = process.env.LOCALFIN_DB_PATH?.trim();
  if (explicitPath) return path.resolve(explicitPath);

  const configuredDataDir = process.env.LOCALFIN_DATA_DIR?.trim();
  const dataDir = configuredDataDir
    ? path.resolve(configuredDataDir)
    : DATABASE_CONFIG.dataDirectory;
  return path.join(dataDir, DATABASE_CONFIG.fileName);
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolveDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const connection = new Database(dbPath);
  try {
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    runMigrations(connection);
    seed(connection);
    db = connection;
    console.log(`Database initialized at ${dbPath}`);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function closeDbForTests(): void {
  if (!db) return;
  db.close();
  db = null;
}

export function toBool(val: number | null | undefined): boolean {
  return val === 1;
}

export function fromBool(val: boolean): number {
  return val ? 1 : 0;
}
