import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { getDb, resolveDatabasePath } from "../server/db/index.js";
import { parseStatement } from "../server/services/parser.js";
import { normalizeTransactionAmount, roundCurrencyAmount } from "../shared/finance/transactionAmounts.js";
import type { TransactionKind } from "../shared/contracts/index.js";

interface CsvAccountPair {
  csv: string;
  account: string;
}

interface StagedRow {
  id: string;
  date: string;
  name: string;
  fromKind: string;
  toKind: string;
  fromAmount: number;
  toAmount: number;
}

function localTimestamp(date: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function repairUsage(): string {
  return "Usage: repair-transaction-signs --csv <path> --account <name> [--csv <path> --account <name> ...] [--apply]";
}

export function parseRepairArgs(argv: string[]): { pairs: CsvAccountPair[]; apply: boolean } | null {
  const pairs: CsvAccountPair[] = [];
  let pendingCsv: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--csv") {
      if (pendingCsv != null) return null;
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) return null;
      pendingCsv = value;
      i += 1;
    } else if (arg === "--account") {
      if (pendingCsv == null) return null;
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) return null;
      pairs.push({ csv: pendingCsv, account: value });
      pendingCsv = null;
      i += 1;
    } else if (arg === "--apply") {
      if (apply) return null;
      apply = true;
    } else if (arg === "--help" || arg === "-h") {
      return null;
    } else {
      return null;
    }
  }
  if (pendingCsv != null || pairs.length === 0) return null;
  return { pairs, apply };
}

function foldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function planSignRepair(pairs: CsvAccountPair[]): Promise<{
  staged: StagedRow[];
  ambiguous: Array<{ key: string; date: string; name: string; absAmount: number; dbIds: string[]; newKind: string; newAmount: number }>;
  csvUnmatched: number;
  dbUntouched: Array<{ id: string; date: string; name: string; amount: number; kind: string }>;
  accountNames: string[];
}> {
  const db = getDb();
  const accounts = db.prepare("SELECT id, name, type FROM accounts WHERE deleted_at IS NULL").all() as Array<{
    id: string;
    name: string;
    type: "asset" | "liability";
  }>;
  const resolveAccount = (query: string): { id: string; name: string; type: "asset" | "liability" } => {
    const folded = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const matches = accounts.filter((a) => a.name.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(folded));
    if (matches.length !== 1) {
      throw new Error(`Account "${query}" matched ${matches.length} accounts`);
    }
    return matches[0] as { id: string; name: string; type: "asset" | "liability" };
  };

  const staged: StagedRow[] = [];
  const ambiguous: Array<{ key: string; date: string; name: string; absAmount: number; dbIds: string[]; newKind: string; newAmount: number }> = [];
  let csvUnmatched = 0;
  const matchedDbIds = new Set<string>();
  const accountNames: string[] = [];
  const csvKeySeen = new Set<string>();

  for (const pair of pairs) {
    const account = resolveAccount(pair.account);
    accountNames.push(account.name);
    const text = readFileSync(path.resolve(pair.csv), "utf8");
    const parsed = await parseStatement(text, account.id);
    const unknownFormat = parsed.errors.find((e) => e.startsWith("Unknown CSV format"));
    if (unknownFormat !== undefined) throw new Error(unknownFormat);

    const rows = db.prepare(
      "SELECT id, date, name, amount, kind FROM transactions WHERE account_id = ? AND deleted_at IS NULL",
    ).all(account.id) as Array<{ id: string; date: string; name: string; amount: number; kind: string }>;
    const byKey = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.date}|${foldName(row.name)}|${Math.abs(row.amount).toFixed(2)}`;
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }

    for (const t of parsed.transactions) {
      if (t.isDuplicate) continue;
      const key = `${t.date}|${foldName(t.name)}|${Math.abs(t.amount).toFixed(2)}`;
      if (csvKeySeen.has(`${account.id}|${key}`)) continue;
      csvKeySeen.add(`${account.id}|${key}`);
      const expectedKind = t.kind;
      const expectedAmount =
        expectedKind === "transfer"
          ? roundCurrencyAmount(-Math.abs(t.amount))
          : normalizeTransactionAmount(Math.abs(t.amount), account.type, expectedKind as TransactionKind);
      const candidates = byKey.get(key) ?? [];
      if (candidates.length === 0) {
        csvUnmatched += 1;
        continue;
      }
      if (candidates.length > 1) {
        ambiguous.push({
          key: `${account.name}|${key}`,
          date: t.date,
          name: t.name,
          absAmount: Math.abs(t.amount),
          dbIds: candidates.map((c) => c.id),
          newKind: expectedKind,
          newAmount: expectedAmount,
        });
        continue;
      }
      const row = candidates[0] as (typeof rows)[number];
      matchedDbIds.add(row.id);
      if (row.kind !== expectedKind || Math.abs(row.amount - expectedAmount) > 0.0001) {
        staged.push({
          id: row.id,
          date: row.date,
          name: row.name,
          fromKind: row.kind,
          toKind: expectedKind,
          fromAmount: row.amount,
          toAmount: expectedAmount,
        });
      }
    }
  }

  const dbUntouched: Array<{ id: string; date: string; name: string; amount: number; kind: string }> = [];
  if (pairs.length === 1 && pairs[0] !== undefined) {
    const account = resolveAccount((pairs[0] as CsvAccountPair).account);
    const rows = db.prepare(
      "SELECT id, date, name, amount, kind FROM transactions WHERE account_id = ? AND deleted_at IS NULL",
    ).all(account.id) as Array<{ id: string; date: string; name: string; amount: number; kind: string }>;
    for (const row of rows) {
      if (!matchedDbIds.has(row.id)) dbUntouched.push(row);
    }
  } else {
    const allRows = db.prepare(
      "SELECT id, date, name, amount, kind FROM transactions WHERE deleted_at IS NULL",
    ).all() as Array<{ id: string; date: string; name: string; amount: number; kind: string }>;
    for (const row of allRows) {
      if (!matchedDbIds.has(row.id)) dbUntouched.push(row);
    }
  }

  return { staged, ambiguous, csvUnmatched, dbUntouched, accountNames };
}

export function applySignRepair(staged: StagedRow[]): { backupPath: string; applied: number } {
  const dbPath = resolveDatabasePath();
  const backupPath = path.resolve(
    path.dirname(dbPath),
    "archive",
    `budget.db.pre-sign-repair-${localTimestamp(new Date())}.bak`,
  );
  copyFileSync(dbPath, backupPath);
  const db = getDb();
  const stmt = db.prepare("UPDATE transactions SET kind = ?, amount = ?, updated_at = datetime('now') WHERE id = ?");
  const applyMany = db.transaction((items: StagedRow[]) => {
    for (const item of items) stmt.run(item.toKind, item.toAmount, item.id);
  });
  applyMany(staged);
  return { backupPath, applied: staged.length };
}

async function main(): Promise<void> {
  const parsed = parseRepairArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(repairUsage());
    process.exitCode = 2;
    return;
  }
  try {
    const plan = await planSignRepair(parsed.pairs);
    console.log(`Staged ${plan.staged.length} updates across ${plan.accountNames.join(", ")}`);
    for (const s of plan.staged.slice(0, 30)) {
      console.log(`  ${s.date} "${s.name}" ${s.fromKind} ${s.fromAmount} -> ${s.toKind} ${s.toAmount} (${s.id})`);
    }
    if (plan.staged.length > 30) console.log(`  ... and ${plan.staged.length - 30} more`);
    console.log(`Ambiguous keys skipped: ${plan.ambiguous.length}`);
    for (const a of plan.ambiguous.slice(0, 20)) {
      console.log(`  ambiguous ${a.date} "${a.name}" ${a.absAmount}: ${a.dbIds.join(", ")}`);
    }
    console.log(`CSV rows with no DB match (ignored): ${plan.csvUnmatched}`);
    console.log(`DB rows with no CSV match (untouched): ${plan.dbUntouched.length}`);
    for (const u of plan.dbUntouched.slice(0, 20)) {
      console.log(`  untouched ${u.date} "${u.name}" ${u.amount} ${u.kind} (${u.id})`);
    }
    if (!parsed.apply) {
      console.log("Dry-run: no writes, no backup. Append --apply to write.");
      return;
    }
    if (plan.staged.length === 0) {
      console.log("Nothing to apply.");
      return;
    }
    const result = applySignRepair(plan.staged);
    console.log(`Backup: ${result.backupPath}; applied ${result.applied}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisPath = new URL(import.meta.url).pathname;
if (invokedPath === thisPath || process.argv[1]?.endsWith("repair-transaction-signs.ts")) {
  void main();
}
