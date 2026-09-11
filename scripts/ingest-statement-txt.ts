import { readFile } from "node:fs/promises";
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
import type { CreateTransactionData } from "../shared/contracts/index.js";
import { isIsoDate } from "../shared/validation.js";
import { exportCategorizeOds } from "./export-categorize-ods.js";

export function ingestUsage(): string {
  return "Usage: ingest:statement <statement.txt> --account <name> [--out review.fods]";
}

export function parseIngestArgs(argv: string[]): {
  input: string;
  account: string;
  out: string | null;
} | null {
  let input: string | null = null;
  let account: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--account") {
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
  if (!input || !account) return null;
  return { input, account, out };
}

export async function ingestStatementTxt(
  input: string,
  accountName: string,
  out: string | null,
): Promise<{ created: number; duplicates: number; needsCategory: string[] }> {
  let text: string;
  try {
    text = await readFile(path.resolve(input), "utf8");
  } catch {
    throw new Error(`Statement file not found: ${path.resolve(input)}`);
  }

  const accounts = getAccounts();
  const account =
    accounts.find((a) => a.name === accountName) ??
    accounts.find((a) => a.name.toLowerCase() === accountName.toLowerCase());
  if (!account) {
    const valid = accounts.map((a) => a.name).join(", ");
    throw new Error(
      `Unknown account "${accountName}". Valid accounts: ${valid === "" ? "(none)" : valid}`,
    );
  }

  const parsed = await parseStatement(text, account.id);
  for (const message of parsed.errors) console.error(message);

  const activeSubcategoryIds = new Set(getSubcategories().map((s) => s.id));
  const duplicates = parsed.transactions.filter((t) => t.isDuplicate);
  const candidates = parsed.transactions.filter((t) => !t.isDuplicate);

  const payloads: CreateTransactionData[] = [];
  let skipped = 0;
  for (const t of candidates) {
    if (!isIsoDate(t.date)) {
      console.error(`Skipping unparseable date: "${t.originalLine}"`);
      skipped += 1;
      continue;
    }
    let subcategoryId: string | null = null;
    const recent = getRecentTransactionByNameAndAccount(t.name, account.id);
    if (
      recent?.subcategory_id != null &&
      activeSubcategoryIds.has(recent.subcategory_id)
    ) {
      subcategoryId = recent.subcategory_id;
    }
    payloads.push({
      account_id: account.id,
      date: t.date,
      name: t.name,
      amount: t.amount,
      kind: t.kind,
      subcategory_id: subcategoryId,
      tag_ids: [],
      ai_suggested: false,
    });
  }

  let createdIds: string[] = [];
  try {
    createdIds = bulkCreateTransactions(payloads).map((t) => t.id);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    console.error(`Bulk create hit a duplicate (${error.message}); continuing per row`);
    for (const payload of payloads) {
      try {
        createdIds.push(createTransaction(payload).id);
      } catch (rowError) {
        if (rowError instanceof OperationalError) {
          console.error(
            `Skipping duplicate "${payload.name}" on ${payload.date}: ${rowError.message}`,
          );
        } else {
          throw rowError;
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
    `Created ${createdIds.length} transactions, ${duplicates.length} duplicates reported, ${skipped} skipped`,
  );
  if (duplicates.length > 0) {
    for (const d of duplicates.slice(0, 20)) {
      console.log(`duplicate: ${d.date} "${d.name}" ${d.amount}`);
    }
    if (duplicates.length > 20) {
      console.log(`... and ${duplicates.length - 20} more duplicates`);
    }
  }

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
  return { created: createdIds.length, duplicates: duplicates.length, needsCategory };
}

async function main(): Promise<void> {
  const parsed = parseIngestArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(ingestUsage());
    process.exitCode = 2;
    return;
  }
  try {
    await ingestStatementTxt(parsed.input, parsed.account, parsed.out);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
