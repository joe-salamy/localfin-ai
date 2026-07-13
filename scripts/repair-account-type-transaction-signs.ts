import Database from "better-sqlite3";
import path from "node:path";
import { normalizeTransactionAmount } from "../shared/finance/transactionAmounts.js"
import type { AccountType, TransactionKind } from "../shared/contracts/index.js"

interface RepairCandidateRow {
  id: string;
  account_id: string;
  account_name: string;
  account_type: AccountType;
  date: string;
  name: string;
  amount: number;
  kind: TransactionKind;
  category_type: "income" | "expense" | null;
  is_initial_balance: number;
}

export interface TransactionSignRepair {
  id: string;
  accountName: string;
  date: string;
  name: string;
  previousAmount: number;
  nextAmount: number;
  previousKind: TransactionKind;
  nextKind: TransactionKind;
}

const LIABILITY_INCOME_NAME_PATTERN =
  /\b(?:(?:internet|mobile|online)?\s*payment\s*(?:-\s*)?thank you|payment received|payment posted|automatic statement credit|statement credit|refund|credit adjustment|cashback|cash back)\b/i;
const INITIAL_BALANCE_NAME_PATTERN = /^initial balance$/i;

function repairKindForRow(row: RepairCandidateRow): TransactionKind | null {
  if (
    row.is_initial_balance ||
    INITIAL_BALANCE_NAME_PATTERN.test(row.name.trim())
  ) {
    return null;
  }
  if (
    row.account_type === "liability" &&
    LIABILITY_INCOME_NAME_PATTERN.test(row.name)
  ) {
    return "income";
  }
  if (row.account_type === "liability" && row.category_type) {
    return row.category_type;
  }
  if (row.category_type && row.category_type !== row.kind) {
    return null;
  }
  return row.kind;
}

export function findTransactionSignRepairs(
  db: Database.Database,
): TransactionSignRepair[] {
  const rows = db
    .prepare(
      `
      SELECT
        t.id,
        t.account_id,
        a.name AS account_name,
        a.type AS account_type,
        t.date,
        t.name,
        t.amount,
        t.kind,
        c.type AS category_type,
        t.is_initial_balance
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
      LEFT JOIN subcategories s ON s.id = t.subcategory_id AND s.deleted_at IS NULL
      LEFT JOIN categories c ON c.id = s.category_id AND c.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
        AND t.kind != 'transfer'
      ORDER BY a.name, t.date, t.created_at, t.id
    `,
    )
    .all() as RepairCandidateRow[];

  return rows.flatMap((row) => {
    const nextKind = repairKindForRow(row);
    if (!nextKind) return [];

    const nextAmount = normalizeTransactionAmount(
      row.amount,
      row.account_type,
      nextKind,
    );

    if (row.kind === nextKind && row.amount === nextAmount) return [];

    return [
      {
        id: row.id,
        accountName: row.account_name,
        date: row.date,
        name: row.name,
        previousAmount: row.amount,
        nextAmount,
        previousKind: row.kind,
        nextKind,
      },
    ];
  });
}

export function applyTransactionSignRepairs(
  db: Database.Database,
  repairs: TransactionSignRepair[],
): void {
  if (repairs.length === 0) return;

  const now = new Date().toISOString();
  const stmt = db.prepare(
    "UPDATE transactions SET amount = ?, kind = ?, updated_at = ? WHERE id = ?",
  );
  const applyAll = db.transaction(() => {
    for (const repair of repairs) {
      stmt.run(repair.nextAmount, repair.nextKind, now, repair.id);
    }
  });
  applyAll();
}

function summarizeRepairs(repairs: TransactionSignRepair[]): void {
  const byAccount = new Map<string, number>();
  for (const repair of repairs) {
    byAccount.set(
      repair.accountName,
      (byAccount.get(repair.accountName) ?? 0) + 1,
    );
  }

  console.log(`Found ${repairs.length} transaction sign repair(s).`);
  for (const [accountName, count] of [...byAccount.entries()].sort()) {
    console.log(`- ${accountName}: ${count}`);
  }

  for (const repair of repairs) {
    console.log(
      [
        repair.id,
        repair.accountName,
        repair.date,
        repair.name,
        `${repair.previousKind}:${repair.previousAmount}`,
        "=>",
        `${repair.nextKind}:${repair.nextAmount}`,
      ].join(" | "),
    );
  }
}

function resolveCliDatabasePath(): string {
  const explicitPath = process.env.LOCALFIN_DB_PATH?.trim();
  if (explicitPath) return path.resolve(explicitPath);
  return path.resolve("data", "budget.db");
}

function runCli(): void {
  const apply = process.argv.includes("--apply");
  const dbPath = resolveCliDatabasePath();
  const db = new Database(dbPath);

  try {
    const repairs = findTransactionSignRepairs(db);
    summarizeRepairs(repairs);
    if (!apply) {
      console.log("Dry run only. Re-run with --apply to update the database.");
      return;
    }

    applyTransactionSignRepairs(db, repairs);
    console.log(`Applied ${repairs.length} repair(s).`);
  } finally {
    db.close();
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runCli();
}
