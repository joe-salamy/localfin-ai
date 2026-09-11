import type Database from "better-sqlite3";

export function up(database: Database.Database): void {
  database.exec(`
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
  `);
}
