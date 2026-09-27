import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getAccounts } from "../server/services/accounts.js";
import { getSubcategories } from "../server/services/categories.js";
import { parseStatement } from "../server/services/parser.js";
import {
  bulkCreateTransactions,
  createTransaction,
} from "../server/services/transactions/create.js";
import {
  getRecentTransactionByNameAndAccount,
  getTransactionById,
} from "../server/services/transactions/read.js";
import { ConflictError, OperationalError } from "../server/errors.js";
import type { Account, CreateTransactionData, EnrichedTransaction } from "../shared/contracts/index.js";
import { isIsoDate } from "../shared/validation.js";
import { exportCategorizeOds } from "./export-categorize-ods.js";

const ARCHIVE_DIR = path.resolve("data", "archive", "statements");
const JSONL_DIR = path.resolve("logs", "jsonl");

/** Fold a name to its comparable form: lowercase alphanumerics only. */
export function normalizeAccountName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function buildTransactionPayloads(
  transactions: EnrichedTransaction[],
  accountId: string,
): { payloads: CreateTransactionData[]; skipped: number } {
  const activeSubcategoryIds = new Set(getSubcategories().map((s) => s.id));
  const payloads: CreateTransactionData[] = [];
  let skipped = 0;
  for (const t of transactions) {
    if (!isIsoDate(t.date)) {
      console.error(`Skipping unparseable date: "${t.originalLine}"`);
      skipped += 1;
      continue;
    }
    let subcategoryId: string | null = null;
    const recent = getRecentTransactionByNameAndAccount(t.name, accountId);
    // Reuse the merchant's usual subcategory only for the same kind: an
    // income subcategory on an expense row fails validation and would abort
    // the whole statement.
    if (
      recent?.subcategory_id != null &&
      recent.kind === t.kind &&
      activeSubcategoryIds.has(recent.subcategory_id)
    ) {
      subcategoryId = recent.subcategory_id;
    }
    payloads.push({
      account_id: accountId,
      date: t.date,
      name: t.name,
      amount: t.amount,
      kind: t.kind,
      subcategory_id: subcategoryId,
      tag_ids: [],
      ai_suggested: false,
    });
  }
  return { payloads, skipped };
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

function localDatePart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localTimePart(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
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

interface ChunkStats {
  accountName: string;
  created: number;
  duplicates: number;
  skipped: number;
  needsCategory: string[];
  profile: string | null;
}

async function processChunk(
  account: Account,
  body: string,
): Promise<ChunkStats> {
  const parsed = await parseStatement(body, account.id);
  for (const message of parsed.errors) console.error(`[${account.name}] ${message}`);
  const unknownFormat = parsed.errors.find((e) => e.startsWith("Unknown CSV format"));
  if (unknownFormat !== undefined) throw new Error(unknownFormat);

  const duplicates = parsed.transactions.filter((t) => t.isDuplicate);
  const candidates = parsed.transactions.filter((t) => !t.isDuplicate);

  const { payloads, skipped } = buildTransactionPayloads(candidates, account.id);

  let createdIds: string[] = [];
  if (payloads.length > 0) {
    try {
      createdIds = bulkCreateTransactions(payloads).map((t) => t.id);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      console.error(`[${account.name}] Bulk create hit a duplicate (${error.message}); continuing per row`);
      for (const payload of payloads) {
        try {
          createdIds.push(createTransaction(payload).id);
        } catch (rowError) {
          if (rowError instanceof OperationalError) {
            console.error(
              `[${account.name}] Skipping duplicate "${payload.name}" on ${payload.date}: ${rowError.message}`,
            );
          } else {
            throw rowError;
          }
        }
      }
    }
  }

  const needsCategory: string[] = [];
  for (const id of createdIds) {
    const row = getTransactionById(id);
    if (
      row?.subcategory_id == null &&
      (row?.kind === "income" || row?.kind === "expense")
    ) {
      needsCategory.push(id);
    }
  }

  console.log(
    `[${account.name}] created ${createdIds.length}, duplicates ${duplicates.length}, skipped ${skipped}`,
  );
  if (duplicates.length > 0) {
    for (const d of duplicates.slice(0, 20)) {
      console.log(`[${account.name}] duplicate: ${d.date} "${d.name}" ${d.amount}`);
    }
    if (duplicates.length > 20) {
      console.log(`[${account.name}] ... and ${duplicates.length - 20} more duplicates`);
    }
  }

  return {
    accountName: account.name,
    created: createdIds.length,
    duplicates: duplicates.length,
    skipped,
    needsCategory,
    profile: parsed.format,
  };
}

/** Move the ingested source CSV into the archive, log to JSONL. Runs only after a successful write. */
function archiveCsvMove(
  srcPath: string,
  accountName: string,
  profile: string | null,
  stats: ChunkStats,
): string {
  const bytes = readFileSync(srcPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const now = new Date();
  const timestamp = `${localDatePart(now)}T${localTimePart(now)}`;
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

  const logPath = path.resolve(JSONL_DIR, `ingest-${localDatePart(now)}.jsonl`);
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
    duplicates: stats.duplicates,
    skipped: stats.skipped,
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
): Promise<ChunkStats> {
  const account = resolveAccountName(accountName, getAccounts());
  const text = readCsvFile(file);
  if (dryRun) {
    const parsed = await parseStatement(text, account.id);
    for (const message of parsed.errors) console.error(`[${account.name}] ${message}`);
    const failedFormat = parsed.errors.find((e) => e.startsWith("Unknown CSV format"));
    if (failedFormat !== undefined) throw new Error(failedFormat);
    const duplicates = parsed.transactions.filter((t) => t.isDuplicate);
    const candidates = parsed.transactions.filter((t) => !t.isDuplicate);
    const payloadBuilt = buildTransactionPayloads(candidates, account.id);
    console.log(
      `[${account.name}] created 0 (dry-run), duplicates ${duplicates.length}, skipped ${payloadBuilt.skipped}, would-create ${payloadBuilt.payloads.length}`,
    );
    return {
      accountName: account.name,
      created: 0,
      duplicates: duplicates.length,
      skipped: payloadBuilt.skipped,
      needsCategory: [],
      profile: parsed.format,
    };
  }
  const stats = await processChunk(account, text);
  const archivePath = archiveCsvMove(path.resolve(file), account.name, stats.profile, stats);
  console.log(`Archived source CSV to ${archivePath}`);
  await maybeExportOds(out, [stats]);
  return stats;
}

async function maybeExportOds(out: string | null, stats: ChunkStats[]): Promise<void> {
  const needsCategory = stats.flatMap((s) => s.needsCategory);
  if (out != null && needsCategory.length > 0) {
    const result = await exportCategorizeOds({
      out,
      needsCategoryOnly: false,
      limit: null,
      ids: needsCategory,
    });
    console.log(`Wrote ${result.path} (${result.exported} rows needing review)`);
  } else if (needsCategory.length > 0) {
    console.log(`needsCategory: ${needsCategory.join(", ")}`);
  }
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
