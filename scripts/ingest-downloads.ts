import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getAccounts } from "../server/services/accounts.js";
import { ingestStatementCsv, resolveAccountName, type IngestStats } from "./ingest-statement-csv.js";
import { DOWNLOADS_DIRECTORY } from "./user-paths.js";

const MAPPING_PATH = fileURLToPath(new URL("./statement-accounts.json", import.meta.url));

const mappingSchema = z.array(
  z.object({ pattern: z.string().min(1), account: z.string().min(1) }).strict(),
);

export interface StatementRule {
  pattern: RegExp;
  account: string;
}

export function loadStatementRules(file = MAPPING_PATH): StatementRule[] {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  return mappingSchema.parse(raw).map((r) => ({ pattern: new RegExp(r.pattern, "i"), account: r.account }));
}

/**
 * Pair each CSV file name with a rule. Files with no matching rule are skipped
 * (the folder is shared with ordinary downloads); a file matching two-plus
 * rules is an error, because the account is ambiguous.
 */
export function mapStatementFiles(
  fileNames: string[],
  rules: StatementRule[],
): { mapped: Array<{ fileName: string; account: string }>; skipped: string[]; errors: string[] } {
  const mapped: Array<{ fileName: string; account: string }> = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const fileName of fileNames) {
    const hits = rules.filter((r) => r.pattern.test(fileName));
    if (hits.length === 1) mapped.push({ fileName, account: (hits[0] as StatementRule).account });
    else if (hits.length === 0) skipped.push(fileName);
    else errors.push(`"${fileName}" matches ${hits.length} rules: ${hits.map((h) => h.account).join(", ")}`);
  }
  return { mapped, skipped, errors };
}

export function ingestDownloadsUsage(): string {
  return "Usage: ingest:downloads [--dir <dir>] [--dry-run] (default dir: ~/Downloads; rules: scripts/statement-accounts.json)";
}

export function parseIngestDownloadsArgs(argv: string[]): { dir: string; dryRun: boolean } | null {
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
  return { dir: path.resolve(dir ?? DOWNLOADS_DIRECTORY), dryRun };
}

/**
 * Ingest every CSV in `dir` that maps to exactly one account. Matched files are
 * account-resolved and dry-run first; any failure aborts before the first
 * write. Unmatched files are reported and left untouched.
 */
export async function ingestDownloads(dir: string, dryRun: boolean): Promise<IngestStats[]> {
  const fileNames = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name)
    .sort();
  if (fileNames.length === 0) {
    console.log(`No CSVs in ${dir}.`);
    return [];
  }

  const { mapped, skipped, errors } = mapStatementFiles(fileNames, loadStatementRules());
  for (const fileName of skipped) {
    console.log(`Skipped (no account rule): ${fileName} — use ingest:csv --account <name> to import it.`);
  }
  if (errors.length > 0) {
    throw new Error(
      `${errors.join("\n")}\nFix scripts/statement-accounts.json. Nothing was written.`,
    );
  }
  if (mapped.length === 0) {
    console.log("No CSVs matched an account rule; nothing to ingest.");
    return [];
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
  const parsed = parseIngestDownloadsArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(ingestDownloadsUsage());
    process.exitCode = 2;
    return;
  }
  try {
    await ingestDownloads(parsed.dir, parsed.dryRun);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
