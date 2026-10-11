import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getAccounts } from "../server/services/accounts.js";
import { localIsoDate, localTimeCompact } from "../server/services/dates.js";
import { parseStatement } from "../server/services/parser.js";
import { bulkCreateTransactions } from "../server/services/transactions/create.js";
import { createCategoryLookup } from "../server/services/transactions/lookup.js";
import type { Account, CreateTransactionData, ParsedStatementRow } from "../shared/contracts/index.js";
import { isIsoDate } from "../shared/validation.js";
import { exportCategorizeOds } from "./export-categorize-ods.js";

const ARCHIVE_DIR = path.resolve("data", "archive", "statements");
const JSONL_DIR = path.resolve("logs", "jsonl");

/** Fold a name to its comparable form: lowercase alphanumerics only. */
export function normalizeAccountName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export interface TransactionPayloads {
  payloads: CreateTransactionData[];
  skipped: number;
  zeroAmount: number;
  lookup: { exact: number; merchant: number };
}

export function buildTransactionPayloads(
  transactions: ParsedStatementRow[],
  accountId: string,
): TransactionPayloads {
  const lookupCategory = createCategoryLookup();
  const payloads: CreateTransactionData[] = [];
  const lookup = { exact: 0, merchant: 0 };
  let skipped = 0;
  let zeroAmount = 0;
  for (const t of transactions) {
    if (!isIsoDate(t.date)) {
      console.error(`Skipping unparseable date: "${t.originalLine}"`);
      skipped += 1;
      continue;
    }
    // $0.00 rows (waived fees, card verifications) move no money.
    if (t.amount === 0) {
      zeroAmount += 1;
      continue;
    }
    // Same-kind reuse only: an income subcategory on an expense row fails
    // validation and would abort the whole statement.
    const hit = lookupCategory(t.name, accountId, t.kind);
    if (hit) lookup[hit.source] += 1;
    payloads.push({
      account_id: accountId,
      date: t.date,
      name: t.name,
      amount: t.amount,
      kind: t.kind,
      subcategory_id: hit?.subcategoryId ?? null,
      tag_ids: [],
      ai_suggested: false,
    });
  }
  return { payloads, skipped, zeroAmount, lookup };
}

/**
 * Fuzzy account resolution: query matches an account when its normalized
 * form contains the normalized query as a substring. Zero matches or two or
 * more matches (collision) abort with an error listing what was found.
 */
export function resolveAccountName(accountName: string, accounts: Account[]): Account {
  const query = normalizeAccountName(accountName);
  if (query === "") {
    throw new Error(
      `Empty account name. Valid accounts: ${accounts.map((a) => a.name).join(", ") || "(none)"}`,
    );
  }
  const matches = accounts.filter((a) => normalizeAccountName(a.name).includes(query));
  if (matches.length === 0) {
    const valid = accounts.map((a) => a.name).join(", ");
    throw new Error(
      `Unknown account "${accountName}". Valid accounts: ${valid === "" ? "(none)" : valid}`,
    );
  }
  if (matches.length > 1) {
    const names = matches.map((a) => `"${a.name}"`).join(", ");
    throw new Error(
      `Ambiguous account "${accountName}" matches ${matches.length} accounts: ${names}`,
    );
  }
  return matches[0] as Account;
}

export function ingestUsage(): string {
  return "Usage: ingest:csv --file <abs path to bank CSV> --account <name> [--out review.fods] [--dry-run]";
}

export function parseIngestArgs(argv: string[]): {
  file: string;
  account: string;
  out: string | null;
  dryRun: boolean;
} | null {
  let file: string | null = null;
  let account: string | null = null;
  let out: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      if (file != null) return null;
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) return null;
      file = value;
      i += 1;
    } else if (arg === "--account") {
      if (account != null) return null;
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) return null;
      account = value;
      i += 1;
    } else if (arg === "--out") {
      if (out != null) return null;
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) return null;
      out = value;
      i += 1;
    } else if (arg === "--dry-run") {
      if (dryRun) return null;
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      return null;
    } else {
      return null;
    }
  }
  if (file == null || account == null) return null;
  return { file, account, out, dryRun };
}

export interface IngestStats {
  file: string;
  accountName: string;
  profile: string | null;
  dryRun: boolean;
  /** Rows written, or rows that would be written on a dry run. */
  created: number;
  duplicates: ParsedStatementRow[];
  skipped: number;
  zeroAmount: number;
  lookup: { exact: number; merchant: number };
  /** Income/expense rows left without a subcategory. */
  needsCategory: number;
  /** Ids of those rows; empty on a dry run. */
  needsCategoryIds: string[];
  archivePath: string | null;
}

/** Parse and plan one statement; throws on an unknown CSV format before any write. */
function planStatement(account: Account, text: string): {
  profile: string | null;
  duplicates: ParsedStatementRow[];
  built: TransactionPayloads;
} {
  const parsed = parseStatement(text, account.id);
  for (const message of parsed.errors) console.error(`[${account.name}] ${message}`);
  const unknownFormat = parsed.errors.find((e) => e.startsWith("Unknown CSV format"));
  if (unknownFormat !== undefined) throw new Error(unknownFormat);
  const duplicates = parsed.transactions.filter((t) => t.isDuplicate);
  const candidates = parsed.transactions.filter((t) => !t.isDuplicate);
  return { profile: parsed.format, duplicates, built: buildTransactionPayloads(candidates, account.id) };
}

export function formatIngestStats(stats: IngestStats): string {
  const created = stats.dryRun ? `would create ${stats.created}` : `created ${stats.created}`;
  return (
    `[${stats.accountName}] ${created} (lookup: ${stats.lookup.exact} exact, ${stats.lookup.merchant} merchant; ` +
    `${stats.needsCategory} need category), duplicates ${stats.duplicates.length}, ` +
    `skipped ${stats.skipped}, $0 rows ${stats.zeroAmount}`
  );
}

/** Move the ingested source CSV into the archive, log to JSONL. Runs only after a successful write. */
function archiveCsvMove(
  srcPath: string,
  accountName: string,
  profile: string | null,
  stats: IngestStats,
): string {
  const bytes = readFileSync(srcPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const now = new Date();
  const timestamp = `${localIsoDate(now)}T${localTimeCompact(now)}`;
  const slugify = (s: string): string => {
    const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug === "" ? "account" : slug;
  };
  const baseName = path.basename(srcPath, path.extname(srcPath));
  const filePart = `${timestamp}-${slugify(accountName)}-${slugify(baseName)}-${sha256.slice(0, 8)}`;
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  let archivePath = path.resolve(ARCHIVE_DIR, `${filePart}.csv`);
  let n = 1;
  while (existsSync(archivePath)) {
    archivePath = path.resolve(ARCHIVE_DIR, `${filePart}-${n}.csv`);
    n += 1;
  }
  try {
    renameSync(srcPath, archivePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    copyFileSync(srcPath, archivePath);
    const copied = readFileSync(archivePath);
    if (!copied.equals(bytes)) {
      throw new Error(`Archive copy byte mismatch for ${srcPath}`);
    }
    unlinkSync(srcPath);
  }

  const logPath = path.resolve(JSONL_DIR, `ingest-${localIsoDate(now)}.jsonl`);
  mkdirSync(JSONL_DIR, { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({
    timestamp: now.toISOString(),
    operation: "statement.ingest",
    account: accountName,
    src_path: srcPath,
    archive_path: archivePath,
    bytes: bytes.length,
    sha256,
    profile,
    created: stats.created,
    needs_category: stats.needsCategory,
    lookup_exact: stats.lookup.exact,
    lookup_merchant: stats.lookup.merchant,
    skipped: stats.skipped,
    zero_amount: stats.zeroAmount,
    duplicates: stats.duplicates.map((d) => ({ date: d.date, name: d.name, amount: d.amount })),
  })}\n`, "utf8");

  return archivePath;
}

function readCsvFile(file: string): string {
  const resolved = path.resolve(file);
  try {
    return readFileSync(resolved, "utf8").replace(/^\uFEFF/, "");
  } catch {
    throw new Error(`CSV file not found: ${resolved}`);
  }
}

export async function ingestStatementCsv(
  file: string,
  accountName: string,
  out: string | null,
  dryRun: boolean,
): Promise<IngestStats> {
  const account = resolveAccountName(accountName, getAccounts());
  const srcPath = path.resolve(file);
  const { profile, duplicates, built } = planStatement(account, readCsvFile(srcPath));
  const stats: IngestStats = {
    file: srcPath,
    accountName: account.name,
    profile,
    dryRun,
    created: built.payloads.length,
    duplicates,
    skipped: built.skipped,
    zeroAmount: built.zeroAmount,
    lookup: built.lookup,
    needsCategory: built.payloads.filter(
      (p) => p.subcategory_id == null && (p.kind === "income" || p.kind === "expense"),
    ).length,
    needsCategoryIds: [],
    archivePath: null,
  };
  if (dryRun) {
    console.log(formatIngestStats(stats));
    return stats;
  }

  // One transaction for the whole statement: any invalid row rolls back all.
  const created = built.payloads.length > 0 ? bulkCreateTransactions(built.payloads) : [];
  stats.needsCategoryIds = created
    .filter((row) => row.subcategory_id == null && (row.kind === "income" || row.kind === "expense"))
    .map((row) => row.id);
  stats.archivePath = archiveCsvMove(srcPath, account.name, profile, stats);
  console.log(formatIngestStats(stats));
  console.log(`Archived source CSV to ${stats.archivePath}`);
  if (out != null && stats.needsCategoryIds.length > 0) {
    const result = await exportCategorizeOds({
      out,
      needsCategoryOnly: true,
      limit: null,
      ids: stats.needsCategoryIds,
    });
    console.log(`Wrote ${result.path} (${result.exported} rows needing review)`);
  }
  return stats;
}

async function main(): Promise<void> {
  const parsed = parseIngestArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(ingestUsage());
    process.exitCode = 2;
    return;
  }
  try {
    await ingestStatementCsv(parsed.file, parsed.account, parsed.out, parsed.dryRun);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
