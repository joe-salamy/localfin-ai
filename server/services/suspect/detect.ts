import crypto from "node:crypto";
import type {
  SuspectEvidence,
  SuspectReasonCode,
  SuspectSeverity,
  SuspectTransactionFinding,
  TransactionWithDetails,
} from "../../../shared/contracts/index.js";
import { netWorthEffect } from "../../../shared/finance/transactionAmounts.js";

interface FindingDraft {
  transaction: TransactionWithDetails;
  reason: SuspectReasonCode;
  severity: SuspectSeverity;
  score: number;
  evidence: SuspectEvidence;
}

type SuspectDetector = (
  tx: TransactionWithDetails,
  peers: TransactionWithDetails[],
) => FindingDraft | null;

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

function medianAbsoluteDeviation(
  values: number[],
  center: number,
): number {
  return median(values.map((value) => Math.abs(value - center))) ?? 0;
}

function outlierScore(
  amount: number,
  peers: number[],
): number | null {
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

function detectExactDuplicate(
  tx: TransactionWithDetails,
  group: TransactionWithDetails[],
): FindingDraft | null {
  if (group.length < 2) return null;
  return {
    transaction: tx,
    reason: "exact_duplicate",
    severity: "high",
    score: 95,
    evidence: {
      summary:
        "This transaction exactly matches another transaction on account, date, name, and amount.",
      details: {
        duplicateIds: group
          .filter((item) => item.id !== tx.id)
          .map((item) => item.id),
      },
    },
  };
}

function detectNearDuplicate(
  tx: TransactionWithDetails,
  peers: TransactionWithDetails[],
): FindingDraft | null {
  const name = normalizeName(tx.name);
  if (!name) return null;
  const matches = peers.filter(
    (candidate) =>
      candidate.id !== tx.id &&
      candidate.account_id === tx.account_id &&
      normalizeName(candidate.name) === name &&
      Math.abs(Math.abs(candidate.amount) - Math.abs(tx.amount)) < 0.01 &&
      dateDistanceDays(candidate.date, tx.date) <= 3 &&
      !(candidate.date === tx.date && candidate.amount === tx.amount),
  );
  if (matches.length === 0) return null;
  return {
    transaction: tx,
    reason: "near_duplicate",
    severity: "medium",
    score: 80,
    evidence: {
      summary:
        "This transaction closely matches another transaction within three days.",
      details: { matchingIds: matches.map((item) => item.id) },
    },
  };
}

function detectMissingCategory(
  tx: TransactionWithDetails,
): FindingDraft | null {
  if (
    (tx.kind === "income" || tx.kind === "expense") &&
    !tx.subcategory_id
  ) {
    return {
      transaction: tx,
      reason: "missing_category",
      severity: "low",
      score: 45,
      evidence: {
        summary: "This income or expense transaction has no subcategory.",
      },
    };
  }
  return null;
}

function createFlaggedWordDetector(
  flaggedWords: string[],
): SuspectDetector {
  return (tx) => {
    const words = findFlaggedWords(tx.name, flaggedWords);
    if (words.length === 0) return null;
    return {
      transaction: tx,
      reason: "flagged_word",
      severity: "medium",
      score: 70,
      evidence: {
        summary: "This transaction name contains configured flagged words.",
        details: { words },
      },
    };
  };
}

function detectLargeAmountOutlier(
  tx: TransactionWithDetails,
  peers: TransactionWithDetails[],
): FindingDraft | null {
  const amounts = peers
    .filter((item) => item.id !== tx.id)
    .map((item) => Math.abs(item.amount));
  const score = outlierScore(Math.abs(tx.amount), amounts);
  if (score == null) return null;
  return {
    transaction: tx,
    reason: "large_amount_outlier",
    severity: score >= 85 ? "high" : "medium",
    score,
    evidence: {
      summary:
        "This amount is unusually large compared with other transactions on the same account and type.",
      details: {
        amount: Math.abs(tx.amount),
        peerCount: amounts.length,
      },
    },
  };
}

function detectMerchantAmountOutlier(
  tx: TransactionWithDetails,
  peers: TransactionWithDetails[],
): FindingDraft | null {
  const amounts = peers
    .filter((item) => item.id !== tx.id)
    .map((item) => Math.abs(item.amount));
  const score = outlierScore(Math.abs(tx.amount), amounts);
  if (score == null) return null;
  return {
    transaction: tx,
    reason: "merchant_amount_outlier",
    severity: score >= 85 ? "high" : "medium",
    score,
    evidence: {
      summary:
        "This amount is unusually large for this merchant-like transaction name.",
      details: {
        merchant: tx.name,
        amount: Math.abs(tx.amount),
        peerCount: amounts.length,
      },
    },
  };
}

function detectRapidSmallCharge(
  tx: TransactionWithDetails,
  group: TransactionWithDetails[],
): FindingDraft | null {
  const smallExpenses = group.filter(
    (item) =>
      item.kind === "expense" &&
      Math.abs(item.amount) > 0 &&
      Math.abs(item.amount) <= 5,
  );
  if (smallExpenses.length < 3) return null;
  if (!smallExpenses.some((item) => item.id === tx.id)) return null;
  return {
    transaction: tx,
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
  };
}

function effectOf(tx: TransactionWithDetails): number {
  return netWorthEffect(tx.amount, tx.account_type ?? "asset");
}

const transferPattern = /\b(payment|transfer|xfer|venmo|zelle|ach)\b/i;

function detectUnmatchedTransfer(
  tx: TransactionWithDetails,
  peers: TransactionWithDetails[],
): FindingDraft | null {
  if (tx.kind !== "transfer" && !transferPattern.test(tx.name)) return null;
  const match = peers.find(
    (candidate) =>
      candidate.id !== tx.id &&
      candidate.account_id !== tx.account_id &&
      Math.abs(effectOf(candidate) + effectOf(tx)) < 0.01 &&
      dateDistanceDays(candidate.date, tx.date) <= 3,
  );
  if (match) return null;
  return {
    transaction: tx,
    reason: "unmatched_transfer_like",
    severity: tx.kind === "transfer" ? "medium" : "low",
    score: tx.kind === "transfer" ? 76 : 52,
    evidence: {
      summary:
        "This transfer-like transaction has no opposite-account matching amount within three days.",
    },
  };
}

export function combineDrafts(
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

export function scoreTransactions(
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
      const draft = detectExactDuplicate(transaction, group);
      if (draft) addDraft(drafts, draft);
    }
  }

  for (const transaction of activeTransactions) {
    const draft = detectNearDuplicate(transaction, activeTransactions);
    if (draft) addDraft(drafts, draft);
  }

  const detectFlaggedWord = createFlaggedWordDetector(flaggedWords);
  for (const transaction of activeTransactions) {
    const missing = detectMissingCategory(transaction);
    if (missing) addDraft(drafts, missing);

    const flagged = detectFlaggedWord(transaction, activeTransactions);
    if (flagged) addDraft(drafts, flagged);
  }

  for (const group of byKey(activeTransactions, (transaction) =>
    [transaction.account_id, transaction.kind].join("|"),
  ).values()) {
    for (const transaction of group) {
      const draft = detectLargeAmountOutlier(transaction, group);
      if (draft) addDraft(drafts, draft);
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
      const draft = detectMerchantAmountOutlier(transaction, group);
      if (draft) addDraft(drafts, draft);
    }
  }

  for (const group of byKey(activeTransactions, (transaction) =>
    [transaction.account_id, transaction.date].join("|"),
  ).values()) {
    for (const transaction of group) {
      const draft = detectRapidSmallCharge(transaction, group);
      if (draft) addDraft(drafts, draft);
    }
  }

  for (const transaction of activeTransactions) {
    const draft = detectUnmatchedTransfer(transaction, activeTransactions);
    if (draft) addDraft(drafts, draft);
  }

  return drafts;
}
