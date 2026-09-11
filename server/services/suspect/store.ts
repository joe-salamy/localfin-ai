import type {
  RunSuspectScanRequest,
  RunSuspectScanResponse,
  SuspectEvidence,
  SuspectFindingFilters,
  SuspectFindingStatus,
  SuspectReasonCode,
  SuspectSeverity,
  SuspectTransactionFinding,
  TransactionFilters,
} from "../../../shared/contracts/index.js";
import { getDb } from "../../db/index.js";
import {
  getTransactionsWithDetails,
  getTransactionById,
} from "../transactions.js";
import { combineDrafts, scoreTransactions } from "./detect.js";
import crypto from "node:crypto";

interface FindingRow {
  id: string;
  scan_run_id: string;
  transaction_id: string;
  status: SuspectFindingStatus;
  severity: SuspectSeverity;
  score: number;
  reason_codes_json: string;
  evidence_json: string;
  created_at: string;
  updated_at: string;
}

interface ScanRunRow {
  id: string;
  filters_json: string;
  total_scanned: number;
  total_findings: number;
  created_at: string;
}

function rowToRun(row: ScanRunRow): ScanRunRow {
  return row;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToFinding(row: FindingRow): SuspectTransactionFinding {
  return {
    id: row.id,
    scan_run_id: row.scan_run_id,
    transaction_id: row.transaction_id,
    status: row.status,
    severity: row.severity,
    score: row.score,
    reason_codes: parseJson<SuspectReasonCode[]>(row.reason_codes_json, []),
    evidence: parseJson<SuspectEvidence>(row.evidence_json, {
      summary: "Suspect transaction finding.",
    }),
    created_at: row.created_at,
    updated_at: row.updated_at,
    transaction: getTransactionById(row.transaction_id) ?? undefined,
  };
}

function applyPriorFindingStatuses(
  findings: SuspectTransactionFinding[],
): void {
  if (findings.length === 0) return;

  const priorStatus = getDb().prepare(`
    SELECT status
    FROM suspect_transaction_findings
    WHERE transaction_id = ?
      AND reason_codes_json = ?
      AND status != 'open'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `);

  for (const finding of findings) {
    const row = priorStatus.get(
      finding.transaction_id,
      JSON.stringify(finding.reason_codes),
    ) as { status: SuspectFindingStatus } | undefined;
    if (row) {
      finding.status = row.status;
    }
  }
}

export function runSuspectTransactionScan(
  request: RunSuspectScanRequest = {},
): RunSuspectScanResponse {
  const db = getDb();
  const filters: TransactionFilters = request.filters ?? {};
  const transactions = getTransactionsWithDetails(filters);
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const findings = combineDrafts(
    runId,
    scoreTransactions(transactions, request.flaggedWords ?? []),
    now,
  );
  applyPriorFindingStatuses(findings);

  const insertRun = db.prepare(`
    INSERT INTO suspect_scan_runs (id, filters_json, total_scanned, total_findings, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertFinding = db.prepare(`
    INSERT INTO suspect_transaction_findings (
      id, scan_run_id, transaction_id, status, severity, score, reason_codes_json, evidence_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertRun.run(
      runId,
      JSON.stringify(filters),
      transactions.length,
      findings.length,
      now,
    );
    for (const finding of findings) {
      insertFinding.run(
        finding.id,
        finding.scan_run_id,
        finding.transaction_id,
        finding.status,
        finding.severity,
        finding.score,
        JSON.stringify(finding.reason_codes),
        JSON.stringify(finding.evidence),
        finding.created_at,
        finding.updated_at,
      );
    }
  })();

  const run = rowToRun(
    db
      .prepare("SELECT * FROM suspect_scan_runs WHERE id = ?")
      .get(runId) as ScanRunRow,
  );
  return { run, findings };
}

function latestRunId(): string | null {
  const row = getDb()
    .prepare(
      "SELECT id FROM suspect_scan_runs ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function getSuspectTransactionFindings(
  filters: SuspectFindingFilters = {},
): SuspectTransactionFinding[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  const runId = filters.runId ?? latestRunId();

  if (runId) {
    clauses.push("scan_run_id = ?");
    params.push(runId);
  }
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.severity) {
    clauses.push("severity = ?");
    params.push(filters.severity);
  }
  if (filters.reason) {
    clauses.push("reason_codes_json LIKE ?");
    params.push(`%"${filters.reason}"%`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `
    SELECT *
    FROM suspect_transaction_findings
    ${where}
    ORDER BY score DESC, created_at DESC
  `,
    )
    .all(...params) as FindingRow[];

  return rows.map(rowToFinding).filter((finding) => finding.transaction);
}

export function updateSuspectTransactionFindingStatus(
  id: string,
  status: SuspectFindingStatus,
): SuspectTransactionFinding | null {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "UPDATE suspect_transaction_findings SET status = ?, updated_at = ? WHERE id = ?",
    )
    .run(status, now, id);
  if (result.changes === 0) return null;

  const row = db
    .prepare("SELECT * FROM suspect_transaction_findings WHERE id = ?")
    .get(id) as FindingRow;
  return rowToFinding(row);
}
