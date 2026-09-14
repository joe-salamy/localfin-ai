import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
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

const DEFAULT_INBOX = path.resolve("data", "statements", "inbox.txt");
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
    if (
      recent?.subcategory_id != null &&
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

export interface InboxChunk {
  /** Raw header text after "## " with any legacy "account:" prefix removed. */
  accountName: string;
  /** Transaction lines belonging to this chunk, verbatim. */
  body: string;
}

const ACCOUNT_HEADER_PATTERN = /^##\s*(.+?)\s*$/;
const LEGACY_ACCOUNT_PREFIX = /^account\s*:\s*/i;

/**
 * Split inbox text into per-account chunks at "## <account>" header lines.
 * The parser never sees the headers. Content before the first header, an
 * empty header name, or a chunk with no transaction lines aborts.
 */
export function parseInboxChunks(text: string): InboxChunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: InboxChunk[] = [];
  let current: { accountName: string; lines: string[] } | null = null;
  let sawHeader = false;

  for (const line of lines) {
    const headerMatch = line.trim().match(ACCOUNT_HEADER_PATTERN);
    if (headerMatch) {
      sawHeader = true;
      if (current) chunks.push({ accountName: current.accountName, body: current.lines.join("\n") });
      const accountName = headerMatch[1].replace(LEGACY_ACCOUNT_PREFIX, "").trim();
      if (accountName === "") {
        throw new Error('Empty "## " account header line');
      }
      current = { accountName, lines: [] };
      continue;
    }
    if (!current) {
      if (line.trim() === "") continue;
      throw new Error(
        `Content before the first "## " account header: "${line.trim().slice(0, 80)}"`,
      );
    }
    current.lines.push(line);
  }
  if (current) chunks.push({ accountName: current.accountName, body: current.lines.join("\n") });

  if (!sawHeader) {
    throw new Error('No "## " account headers found in input');
  }
  const empty = chunks.filter((c) => c.body.trim() === "");
  if (empty.length > 0) {
    throw new Error(
      `No transaction lines under header "${empty[0]?.accountName}"`,
    );
  }
  return chunks;
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
  return "Usage: ingest:statement [inbox.txt] [--account <name>] [--out review.fods]\n" +
    "Default input: data/statements/inbox.txt. Split accounts with '## <account name>' header lines.\n" +
    "Without headers, pass --account (fuzzy: 'chase' matches 'Chase Sapphire Preferred').";
}

export function parseIngestArgs(argv: string[]): {
  input: string | null;
  account: string | null;
  out: string | null;
} | null {
  let input: string | null = null;
  let account: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--account") {
      if (account != null) return null;
      account = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--out") {
      out = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      return null;
    } else if (arg.startsWith("--")) {
      return null;
    } else if (input == null) {
      input = arg;
    } else {
      return null;
    }
  }
  return { input, account, out };
}

interface ChunkStats {
  accountName: string;
  created: number;
  duplicates: number;
  skipped: number;
  needsCategory: string[];
}

async function processChunk(
  account: Account,
  body: string,
): Promise<ChunkStats> {
  const parsed = await parseStatement(body, account.id);
  for (const message of parsed.errors) console.error(`[${account.name}] ${message}`);

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
  };
}

/** Archive the verbatim input, log to JSONL, then truncate the inbox. */
function archiveInbox(rawText: string, accountNames: string[]): string {
  const now = new Date();
  const timestamp = `${localDatePart(now)}T${localTimePart(now)}`;
  const slugPart = accountNames
    .map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .map((slug) => (slug === "" ? "account" : slug))
    .join("-");
  let archivePath = path.resolve(ARCHIVE_DIR, `${timestamp}-${slugPart}.txt`);
  let n = 1;
  while (existsSync(archivePath)) {
    archivePath = path.resolve(ARCHIVE_DIR, `${timestamp}-${slugPart}-${n}.txt`);
    n += 1;
  }
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  copyFileSync(DEFAULT_INBOX, archivePath);

  const logPath = path.resolve(JSONL_DIR, `ingest-${localDatePart(now)}.jsonl`);
  mkdirSync(JSONL_DIR, { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({
    timestamp: now.toISOString(),
    operation: "statement.ingest",
    accounts: accountNames,
    archive_path: archivePath,
    bytes: rawText.length,
  })}\n`, "utf8");

  truncateSync(DEFAULT_INBOX, 0);
  return archivePath;
}

export async function ingestStatementTxt(
  input: string,
  accountName: string,
  out: string | null,
): Promise<ChunkStats> {
  const text = readInbox(input);
  const account = resolveAccountName(accountName, getAccounts());
  const stats = await processChunk(account, text);
  const archivePath = archiveInbox(text, [account.name]);
  console.log(`Archived input to ${archivePath}; inbox truncated`);
  await maybeExportOds(out, [stats]);
  return stats;
}

export async function ingestHeaderedInbox(
  input: string,
  out: string | null,
): Promise<ChunkStats[]> {
  const text = readInbox(input);
  const accounts = getAccounts();
  const chunks = parseInboxChunks(text);
  const resolved = chunks.map((c) => ({ chunk: c, account: resolveAccountName(c.accountName, accounts) }));
  const seen = new Set<string>();
  for (const { account } of resolved) {
    if (seen.has(account.id)) {
      throw new Error(`Duplicate header for "${account.name}" resolves to the same account twice`);
    }
    seen.add(account.id);
  }
  const stats: ChunkStats[] = [];
  for (const { chunk, account } of resolved) {
    stats.push(await processChunk(account, chunk.body));
  }
  const archivePath = archiveInbox(text, stats.map((s) => s.accountName));
  console.log(`Archived input to ${archivePath}; inbox truncated`);
  await maybeExportOds(out, stats);
  return stats;
}

function readInbox(input: string): string {
  const resolved = path.resolve(input);
  try {
    return readFileSync(resolved, "utf8");
  } catch {
    throw new Error(`Statement file not found: ${resolved}`);
  }
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
  const input = parsed.input ?? DEFAULT_INBOX;
  try {
    if (parsed.account != null) {
      await ingestStatementTxt(input, parsed.account, parsed.out);
    } else {
      await ingestHeaderedInbox(input, parsed.out);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
