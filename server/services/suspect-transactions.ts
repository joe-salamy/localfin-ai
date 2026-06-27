import crypto from "node:crypto";
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
  TransactionWithDetails,
} from "../../src/types/index.js";
import { getDb } from "../db/index.js";
import {
  getTransactionsWithDetails,
  getTransactionById,
} from "./transactions.js";

interface FindingDraft {
  transaction: TransactionWithDetails;
  reason: SuspectReasonCode;
  severity: SuspectSeverity;
  score: number;
  evidence: SuspectEvidence;
}

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

const severityRank: Record<SuspectSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dateDistanceDays(a: string, b: string): number {
  const left = new Date(`${a}T00:00:00.000Z`).getTime();
  const right = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.abs(left - right) / 86_400_000;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function medianAbsoluteDeviation(values: number[], center: number): number {
  return median(values.map((value) => Math.abs(value - center))) ?? 0;
}

function outlierScore(amount: number, peers: number[]): number | null {
  if (peers.length < 5) return null;
  const center = median(peers);
  if (center == null || center <= 0) return null;
  const mad = medianAbsoluteDeviation(peers, center);
  const robustSpread = Math.max(mad * 1.4826, center * 0.15, 10);
  const z = (amount - center) / robustSpread;
  if (z < 4 || amount < center * 2) return null;
  return Math.min(100, Math.round(55 + z * 8));
}

function normalizeWords(words: string[]): string[] {
  return Array.from(
    new Set(words.map((word) => word.trim().toLowerCase()).filter(Boolean)),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFlaggedWords(name: string, words: string[]): string[] {
  return normalizeWords(words).filter((word) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegex(word)}(?=$|[^a-z0-9])`, "i").test(
      name,
    ),
  );
}

function addDraft(drafts: FindingDraft[], draft: FindingDraft): void {
  drafts.push(draft);
}

function byKey<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const current = groups.get(key);
    if (current) {
      current.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

function reasonLabel(reason: SuspectReasonCode): string {
  return reason
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function combineDrafts(
  scanRunId: string,
  drafts: FindingDraft[],
  createdAt: string,
): SuspectTransactionFinding[] {
  const grouped = byKey(drafts, (draft) => draft.transaction.id);
  return Array.from(grouped.entries())
    .map(([transactionId, items]) => {
      const reasons = Array.from(new Set(items.map((item) => item.reason)));
      const topSeverity = items.reduce<SuspectSeverity>(
        (current, item) =>
          severityRank[item.severity] > severityRank[current]
            ? item.severity
            : current,
        "low",
      );
      const score = Math.min(
        100,
        Math.max(...items.map((item) => item.score)) +
          Math.max(0, reasons.length - 1) * 5,
      );
      const summaries = items.map((item) => item.evidence.summary);

      return {
        id: crypto.randomUUID(),
        scan_run_id: scanRunId,
        transaction_id: transactionId,
        status: "open" as const,
        severity: topSeverity,
        score,
        reason_codes: reasons,
        evidence: {
          summary: summaries.join(" "),
          details: {
            reasons: reasons.map(reasonLabel),
            reasonCount: reasons.length,
          },
        },
        transaction: items[0].transaction,
        created_at: createdAt,
        updated_at: createdAt,
      };
    })
    .sort(
      (a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at),
    );
}

function scoreTransactions(
  transactions: TransactionWithDetails[],
  flaggedWords: string[],
): FindingDraft[] {
  const drafts: FindingDraft[] = [];
  const activeTransactions = transactions.filter(
    (transaction) => !transaction.is_initial_balance,
  );
  const normalized = new Map(
    activeTransactions.map((transaction) => [
      transaction.id,
      normalizeName(transaction.name),
    ]),
  );

  for (const group of byKey(activeTransactions, (transaction) =>
    [
      transaction.account_id,
      transaction.date,
      normalized.get(transaction.id),
      transaction.amount,
    ].join("|"),
  ).values()) {
    if (group.length < 2) continue;
    for (const transaction of group) {
      addDraft(drafts, {
        transaction,
        reason: "exact_duplicate",
        severity: "high",
        score: 95,
        evidence: {
          summary:
            "This transaction exactly matches another transaction on account, date, name, and amount.",
          details: {
            duplicateIds: group
              .filter((item) => item.id !== transaction.id)
              .map((item) => item.id),
          },
        },
      });
    }
  }

  for (let index = 0; index < activeTransactions.length; index += 1) {
    const transaction = activeTransactions[index];
    const name = normalized.get(transaction.id);
    if (!name) continue;
    const matches = activeTransactions.filter(
      (candidate, candidateIndex) =>
        candidateIndex !== index &&
        candidate.account_id === transaction.account_id &&
        normalized.get(candidate.id) === name &&
        Math.abs(Math.abs(candidate.amount) - Math.abs(transaction.amount)) <
          0.01 &&
        dateDistanceDays(candidate.date, transaction.date) <= 3 &&
        !(
          candidate.date === transaction.date &&
          candidate.amount === transaction.amount
        ),
    );
    if (matches.length === 0) continue;
    addDraft(drafts, {
      transaction,
      reason: "near_duplicate",
      severity: "medium",
      score: 80,
      evidence: {
        summary:
          "This transaction closely matches another transaction within three days.",
        details: { matchingIds: matches.map((item) => item.id) },
      },
    });
  }

  for (const transaction of activeTransactions) {
    if (
      (transaction.kind === "income" || transaction.kind === "expense") &&
      !transaction.subcategory_id
    ) {
      addDraft(drafts, {
        transaction,
        reason: "missing_category",
        severity: "low",
        score: 45,
        evidence: {
          summary: "This income or expense transaction has no subcategory.",
        },
      });
    }

    const words = findFlaggedWords(transaction.name, flaggedWords);
    if (words.length > 0) {
      addDraft(drafts, {
        transaction,
        reason: "flagged_word",
        severity: "medium",
        score: 70,
        evidence: {
          summary: "This transaction name contains configured flagged words.",
          details: { words },
        },
      });
    }
  }

  for (const group of byKey(activeTransactions, (transaction) =>
    [transaction.account_id, transaction.kind].join("|"),
  ).values()) {
    for (const transaction of group) {
      const peers = group
        .filter((item) => item.id !== transaction.id)
        .map((item) => Math.abs(item.amount));
      const score = outlierScore(Math.abs(transaction.amount), peers);
      if (score == null) continue;
      addDraft(drafts, {
        transaction,
        reason: "large_amount_outlier",
        severity: score >= 85 ? "high" : "medium",
        score,
        evidence: {
          summary:
            "This amount is unusually large compared with other transactions on the same account and type.",
          details: {
            amount: Math.abs(transaction.amount),
            peerCount: peers.length,
          },
        },
      });
    }
  }

  for (const group of byKey(activeTransactions, (transaction) =>
    [
      transaction.account_id,
      transaction.kind,
      normalized.get(transaction.id),
    ].join("|"),
  ).values()) {
    for (const transaction of group) {
      const peers = group
        .filter((item) => item.id !== transaction.id)
        .map((item) => Math.abs(item.amount));
      const score = outlierScore(Math.abs(transaction.amount), peers);
      if (score == null) continue;
      addDraft(drafts, {
        transaction,
        reason: "merchant_amount_outlier",
        severity: score >= 85 ? "high" : "medium",
        score,
        evidence: {
          summary:
            "This amount is unusually large for this merchant-like transaction name.",
          details: {
            merchant: transaction.name,
            amount: Math.abs(transaction.amount),
            peerCount: peers.length,
          },
        },
      });
    }
  }

  for (const group of byKey(activeTransactions, (transaction) =>
    [transaction.account_id, transaction.date].join("|"),
  ).values()) {
    const smallExpenses = group.filter(
      (transaction) =>
        transaction.kind === "expense" &&
        Math.abs(transaction.amount) > 0 &&
        Math.abs(transaction.amount) <= 5,
    );
    if (smallExpenses.length < 3) continue;
    for (const transaction of smallExpenses) {
      addDraft(drafts, {
        transaction,
        reason: "rapid_small_charge_cluster",
        severity: "medium",
        score: 72,
        evidence: {
          summary:
            "This is part of a same-day cluster of small charges on the same account.",
          details: {
            clusterSize: smallExpenses.length,
            clusterIds: smallExpenses.map((item) => item.id),
          },
        },
      });
    }
  }

  const transferPattern = /\b(payment|transfer|xfer|venmo|zelle|ach)\b/i;
  for (const transaction of activeTransactions) {
    if (
      transaction.kind !== "transfer" &&
      !transferPattern.test(transaction.name)
    )
      continue;
    const match = activeTransactions.find(
      (candidate) =>
        candidate.id !== transaction.id &&
        candidate.account_id !== transaction.account_id &&
        Math.abs(candidate.amount + transaction.amount) < 0.01 &&
        dateDistanceDays(candidate.date, transaction.date) <= 3,
    );
    if (match) continue;
    addDraft(drafts, {
      transaction,
      reason: "unmatched_transfer_like",
      severity: transaction.kind === "transfer" ? "medium" : "low",
      score: transaction.kind === "transfer" ? 76 : 52,
      evidence: {
        summary:
          "This transfer-like transaction has no opposite-account matching amount within three days.",
      },
    });
  }

  return drafts;
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
