import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getAccounts } from "../server/services/accounts.js";
import { ingestStatementCsv, resolveAccountName, type IngestStats } from "./ingest-statement-csv.js";

const DEFAULT_INBOX = path.join(os.homedir(), "Inbox");
const MAPPING_PATH = fileURLToPath(new URL("./inbox-accounts.json", import.meta.url));

const mappingSchema = z.array(
  z.object({ pattern: z.string().min(1), account: z.string().min(1) }).strict(),
);

export interface InboxRule {
  pattern: RegExp;
  account: string;
}

export function loadInboxRules(file = MAPPING_PATH): InboxRule[] {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  return mappingSchema.parse(raw).map((r) => ({ pattern: new RegExp(r.pattern, "i"), account: r.account }));
}

/** Pair each CSV file name with exactly one rule; unmapped or multiply-mapped files are errors. */
export function mapInboxFiles(
  fileNames: string[],
  rules: InboxRule[],
): { mapped: Array<{ fileName: string; account: string }>; errors: string[] } {
  const mapped: Array<{ fileName: string; account: string }> = [];
  const errors: string[] = [];
  for (const fileName of fileNames) {
    const hits = rules.filter((r) => r.pattern.test(fileName));
    if (hits.length === 1) mapped.push({ fileName, account: (hits[0] as InboxRule).account });
    else if (hits.length === 0) errors.push(`No account rule matches "${fileName}"`);
    else errors.push(`"${fileName}" matches ${hits.length} rules: ${hits.map((h) => h.account).join(", ")}`);
  }
  return { mapped, errors };
}

export function ingestInboxUsage(): string {
  return "Usage: ingest:inbox [--dir <staging dir>] [--dry-run] (default dir: ~/Inbox; rules: scripts/inbox-accounts.json)";
}

export function parseIngestInboxArgs(argv: string[]): { dir: string; dryRun: boolean } | null {
  let dir: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") {
      const value = argv[i + 1];
      if (dir != null || value == null || value.startsWith("--")) return null;
      dir = value;
      i += 1;
    } else if (arg === "--dry-run" && !dryRun) {
      dryRun = true;
    } else {
      return null;
    }
  }
  return { dir: path.resolve(dir ?? DEFAULT_INBOX), dryRun };
}

/**
 * Ingest every staged CSV in `dir`. All files are mapped, account-resolved
 * and dry-run first; any failure aborts before the first write.
 */
export async function ingestInbox(dir: string, dryRun: boolean): Promise<IngestStats[]> {
  const fileNames = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name)
    .sort();
  if (fileNames.length === 0) {
    console.log(`No staged CSVs in ${dir}; run csvinbox first.`);
    return [];
  }

  const { mapped, errors } = mapInboxFiles(fileNames, loadInboxRules());
  if (errors.length > 0) {
    throw new Error(
      `${errors.join("\n")}\nAdd a rule to scripts/inbox-accounts.json or use ingest:csv --account. Nothing was written.`,
    );
  }
  const accounts = getAccounts();
  const jobs = mapped.map((m) => ({
    file: path.join(dir, m.fileName),
    account: resolveAccountName(m.account, accounts).name,
  }));

  const preflight: IngestStats[] = [];
  for (const job of jobs) preflight.push(await ingestStatementCsv(job.file, job.account, null, true));
  if (dryRun) return preflight;

  const results: IngestStats[] = [];
  for (const job of jobs) results.push(await ingestStatementCsv(job.file, job.account, null, false));
  const created = results.reduce((sum, s) => sum + s.created, 0);
  const needsCategory = results.reduce((sum, s) => sum + s.needsCategory, 0);
  console.log(`Total: ${results.length} files, created ${created}, ${needsCategory} need category.`);
  return results;
}

async function main(): Promise<void> {
  const parsed = parseIngestInboxArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(ingestInboxUsage());
    process.exitCode = 2;
    return;
  }
  try {
    await ingestInbox(parsed.dir, parsed.dryRun);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
