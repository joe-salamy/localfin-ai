import type {
  AccountType,
  ParseStatementResult,
  ParsedStatementRow,
  TransactionKind,
} from "../../shared/contracts/index.js";
import {
  netWorthEffect,
  normalizeTransactionAmount,
  roundCurrencyAmount,
} from "../../shared/finance/transactionAmounts.js"
import { decodeHtmlEntities } from "../../shared/finance/merchantNames.js";
import { isIsoDate } from "../../shared/validation.js";
import { getDb } from "../db/index.js";
import { localIsoDate } from "./dates.js";
import { checkDuplicates } from "./transactions/checks.js";

type BankProfileId = "chase" | "usbank" | "discover" | "fidelity";

// Sign of a raw CSV amount that adds money to the account holder: Chase and
// US Bank export payments/deposits as positive, Discover exports them negative.
const PROFILE_INFLOW_SIGN: Record<BankProfileId, 1 | -1> = {
  chase: 1,
  usbank: 1,
  discover: -1,
  fidelity: 1,
};

function detectBankProfile(headers: string[]): BankProfileId | null {
  const normalized = headers.map((cell) => cell.trim().replace(/^["']|["']$/g, "").trim().toLowerCase());
  const has = (target: string): boolean => normalized.includes(target);
  if (has("type") && has("transaction date") && has("description")) {
    return "chase";
  }
  if (has("transaction") && has("name") && has("memo")) {
    return "usbank";
  }
  if (has("trans. date")) {
    return "discover";
  }
  if (has("run date") && has("action") && (has("amount ($)") || has("amount"))) {
    return "fidelity";
  }
  return null;
}
const TRANSFER_NAME_PATTERN =
  /\b(?:transfer|online transfer|credit card payment|payment thank you|internet payment|mobile payment|web authorized pmt|mobile banking payment|autopay|ach payment|card payment|payment received|payment posted)\b/i;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

// ---------- Date parsing ----------

// Returns YYYY-MM-DD, or the trimmed input when it cannot be read as a date
// (the row is then flagged for review). Statements without a year are dated
// in the most recent year that does not put the row in the future.
export function parseDate(raw: string, today = new Date()): string {
  const trimmed = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // MM/DD/YYYY or MM/DD/YY or MM/DD
  const slashMatch = trimmed.match(
    /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/,
  );
  if (!slashMatch) return trimmed;

  const month = slashMatch[1].padStart(2, "0");
  const day = slashMatch[2].padStart(2, "0");
  const rawYear = slashMatch[3];
  if (rawYear === undefined) {
    const todayIso = localIsoDate(today);
    const thisYear = `${today.getFullYear()}-${month}-${day}`;
    return thisYear <= todayIso ? thisYear : `${today.getFullYear() - 1}-${month}-${day}`;
  }
  if (rawYear.length === 2) {
    const twoDigit = parseInt(rawYear, 10);
    return `${twoDigit >= 70 ? "19" : "20"}${rawYear}-${month}-${day}`;
  }
  return `${rawYear}-${month}-${day}`;
}

// ---------- Amount parsing ----------

function parseAmount(raw: string): number {
  let str = raw.trim();

  // Handle DR/CR suffix
  const isDebit = /DR$/i.test(str);
  const isCredit = /CR$/i.test(str);
  str = str.replace(/\s*(DR|CR)\s*$/i, "");

  // Handle parentheses for negative: (123.45)
  const parenMatch = str.match(/^\((.+)\)$/);
  let negative = false;
  if (parenMatch) {
    str = parenMatch[1];
    negative = true;
  }

  // Handle leading minus
  if (str.startsWith("-")) {
    negative = true;
    str = str.slice(1);
  }

  // Remove $ and commas
  str = str.replace(/[$,]/g, "");

  let value = parseFloat(str);
  if (isNaN(value)) return 0;

  if (negative) value = -value;
  if (isDebit && value > 0) value = -value;
  if (isCredit && value < 0) value = -value;

  return Math.round(value * 100) / 100;
}

// ---------- Name cleaning ----------

const PREFIX_PATTERN = /^(?:POS|ACH|CHECK|DEBIT|CREDIT|PURCHASE)\s+/i;
const TRAILING_REF_PATTERN = /\s+\d{6,}$/;

function cleanName(raw: string): string {
  let name = decodeHtmlEntities(raw).trim();
  // Collapse whitespace
  name = name.replace(/\s+/g, " ");
  // Remove common prefixes
  name = name.replace(PREFIX_PATTERN, "");
  // Remove trailing reference numbers
  name = name.replace(TRAILING_REF_PATTERN, "");
  return name.trim();
}

const UNKNOWN_FORMAT_SUFFIX =
  "Expected one of: Chase (Transaction Date,...,Type,...), US Bank (Date,Transaction,Name,Memo,Amount), Discover (Trans. Date,...,Category), Fidelity (Run Date,Action,...,Amount ($)).";

function emptyResult(format: string | null, error: string): ParseStatementResult {
  return {
    transactions: [],
    summary: { total: 0, duplicates: 0, needsReview: 0 },
    format,
    parseSuccessRate: 0,
    errors: [error],
  };
}

export function parseStatement(
  text: string,
  accountId: string,
): ParseStatementResult {
  const errors: string[] = [];
  const withoutBom = text.replace(/^\uFEFF/, "");
  const rawLines = withoutBom.split(/\r?\n/);

  let headerIndex = -1;
  for (let i = 0; i < rawLines.length; i += 1) {
    if ((rawLines[i] ?? "").trim() !== "") {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return emptyResult(null, "No lines found in input text");
  }

  const headerLine = (rawLines[headerIndex] ?? "").trim();
  const headerFields = parseCsvLine(headerLine);
  const normalizedHeaders = headerFields.map((cell) => cell.trim().replace(/^["']|["']$/g, "").trim().toLowerCase());
  const profile = detectBankProfile(headerFields);

  const columnIndex = (target: string): number => normalizedHeaders.indexOf(target);

  let dateIdx = -1;
  let nameIdx = -1;
  let amountIdx = -1;
  let discriminatorIdx = -1;
  if (profile === "chase") {
    dateIdx = columnIndex("transaction date");
    nameIdx = columnIndex("description");
    amountIdx = columnIndex("amount");
    discriminatorIdx = columnIndex("type");
  } else if (profile === "usbank") {
    dateIdx = columnIndex("date");
    discriminatorIdx = columnIndex("transaction");
    nameIdx = columnIndex("name");
    amountIdx = columnIndex("amount");
  } else if (profile === "discover") {
    dateIdx = columnIndex("trans. date");
    nameIdx = columnIndex("description");
    amountIdx = columnIndex("amount");
    discriminatorIdx = columnIndex("category");
  } else if (profile === "fidelity") {
    dateIdx = columnIndex("run date");
    nameIdx = columnIndex("action");
    amountIdx = columnIndex("amount ($)");
    if (amountIdx === -1) amountIdx = columnIndex("amount");
    discriminatorIdx = columnIndex("action");
  }

  const columnsMissing =
    profile === null || dateIdx === -1 || nameIdx === -1 || amountIdx === -1 || discriminatorIdx === -1;
  if (columnsMissing) {
    return emptyResult(
      null,
      `Unknown CSV format. Headers seen: ${headerLine}. ${UNKNOWN_FORMAT_SUFFIX}`,
    );
  }

  const resolvedProfile = profile as BankProfileId;
  let statusIdx = columnIndex("status");
  if (statusIdx === -1) statusIdx = columnIndex("state");

  const db = getDb();
  const account = db
    .prepare(
      "SELECT name, type FROM accounts WHERE id = ? AND deleted_at IS NULL",
    )
    .get(accountId) as { name: string; type: AccountType } | undefined;
  if (!account) {
    return emptyResult(resolvedProfile, `Account with id "${accountId}" not found`);
  }

  const parsed: Array<Omit<ParsedStatementRow, "isDuplicate">> = [];
  let failedLines = 0;
  let pendingSkipped = 0;
  const MAX_LINE_LENGTH = 1_000;

  const dataLines = rawLines.slice(headerIndex + 1);
  let totalDataRows = 0;
  for (const rawLine of dataLines) {
    if (rawLine.trim() === "") continue;
    const line = rawLine.trim();
    if (resolvedProfile === "fidelity" && !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(line)) continue;
    totalDataRows += 1;
    if (line.length > MAX_LINE_LENGTH) {
      failedLines++;
      if (failedLines <= 5) {
        errors.push(
          `Line too long (${line.length} chars): "${line.slice(0, 80)}"`,
        );
      }
      continue;
    }

    const fields = parseCsvLine(rawLine.trim());
    if (fields.length !== headerFields.length) {
      failedLines++;
      if (failedLines <= 5) {
        errors.push(
          `Column count mismatch (expected ${headerFields.length}, saw ${fields.length}): "${line.slice(0, 80)}"`,
        );
      }
      continue;
    }

    if (statusIdx !== -1) {
      const statusValue = (fields[statusIdx] ?? "").trim().toLowerCase();
      if (statusValue.includes("pending")) {
        pendingSkipped += 1;
        continue;
      }
    }

    const rawDate = fields[dateIdx] ?? "";
    const rawName = fields[nameIdx] ?? "";
    const rawAmountStr = fields[amountIdx] ?? "";
    const discriminatorRaw = fields[discriminatorIdx] ?? "";

    const date = parseDate(rawDate);
    const name = cleanName(rawName);
    const rawAmountValue = parseAmount(rawAmountStr);
    const magnitude = Math.abs(rawAmountValue);

    if (!name) {
      failedLines++;
      errors.push(`Empty name after cleaning: "${line.slice(0, 80)}"`);
      continue;
    }

    let kind: TransactionKind | null = null;
    if (resolvedProfile === "chase") {
      if (TRANSFER_NAME_PATTERN.test(name)) {
        kind = "transfer";
      } else {
        const typeLower = discriminatorRaw.trim().toLowerCase();
        if (typeLower === "sale") kind = "expense";
        else if (typeLower === "return") kind = "income";
        else if (typeLower === "fee") kind = "expense";
        else if (typeLower === "payment") kind = "transfer";
        else if (typeLower === "adjustment") kind = rawAmountValue > 0 ? "income" : "expense";
        else {
          failedLines++;
          if (failedLines <= 5) {
            errors.push(
              `Unknown Chase Type "${discriminatorRaw.trim().slice(0, 40)}": "${line.slice(0, 80)}"`,
            );
          }
          continue;
        }
      }
    } else if (resolvedProfile === "usbank") {
      if (TRANSFER_NAME_PATTERN.test(name)) {
        kind = "transfer";
      } else {
        const txnLower = discriminatorRaw.trim().toLowerCase();
        if (txnLower === "debit") kind = "expense";
        else if (txnLower === "credit") kind = "income";
        else {
          failedLines++;
          if (failedLines <= 5) {
            errors.push(
              `Unknown US Bank Transaction "${discriminatorRaw.trim().slice(0, 40)}": "${line.slice(0, 80)}"`,
            );
          }
          continue;
        }
      }
    } else if (resolvedProfile === "fidelity") {
      const actionNorm = discriminatorRaw.trim().toLowerCase();
      if (actionNorm.startsWith("reinvestment")) {
        kind = "transfer";
      } else if (actionNorm.startsWith("dividend received")) {
        kind = "income";
      } else if (actionNorm.startsWith("you bought")) {
        kind = actionNorm.includes("(cash)") ? "transfer" : "expense";
      } else if (actionNorm.startsWith("you sold")) {
        kind = actionNorm.includes("(cash)") ? "transfer" : "income";
      } else if (
        actionNorm.startsWith("electronic funds transfer paid") ||
        actionNorm.startsWith("transfer of assets acat") ||
        actionNorm.startsWith("cash contribution") ||
        actionNorm.startsWith("journaled") ||
        actionNorm.startsWith("transferred to")
      ) {
        kind = "transfer";
      } else if (actionNorm.startsWith("electronic funds transfer received")) {
        kind = "transfer";
      } else if (actionNorm.includes("margin interest") || actionNorm.includes("transaction costs")) {
        kind = "expense";
      } else {
        failedLines++;
        if (failedLines <= 5) {
          errors.push(
            `Unknown Fidelity Action "${discriminatorRaw.trim().slice(0, 40)}": "${line.slice(0, 80)}"`,
          );
        }
        continue;
      }
    } else {
      const categoryNorm = discriminatorRaw.trim().toLowerCase();
      if (categoryNorm.includes("payments and credits")) {
        kind = TRANSFER_NAME_PATTERN.test(name) ? "transfer" : "income";
      } else if (categoryNorm.includes("awards")) {
        kind = "income";
      } else {
        kind = "expense";
      }
    }

    const resolvedKind = kind as TransactionKind;
    // Transfers keep their direction: inbound money raises the account's
    // net-worth effect, outbound lowers it, whatever the account type.
    const storedAmount =
      resolvedKind === "transfer"
        ? roundCurrencyAmount(
            netWorthEffect(rawAmountValue * PROFILE_INFLOW_SIGN[resolvedProfile], account.type),
          )
        : normalizeTransactionAmount(magnitude, account.type, resolvedKind);

    const needsReview = storedAmount === 0 || !isIsoDate(date);

    parsed.push({
      date,
      name,
      amount: storedAmount,
      needsReview,
      originalLine: line,
      kind: resolvedKind,
    });
  }

  if (failedLines > 5) {
    errors.push(`... and ${failedLines - 5} more unparseable lines`);
  }
  if (pendingSkipped > 0) {
    errors.push(`Skipped ${pendingSkipped} pending rows`);
  }

  // Fail fast before duplicate queries: an unbounded
  // record count would let one request fan out into unbounded DB work
  // (the route caps input chars, not parsed records).
  const MAX_PARSED_RECORDS = 1_000;
  if (parsed.length > MAX_PARSED_RECORDS) {
    errors.push(
      `Input produced ${parsed.length} transactions; the maximum is ${MAX_PARSED_RECORDS}.`,
    );
    parsed.length = MAX_PARSED_RECORDS;
  }

  const duplicateFlags = checkDuplicates(
    parsed.map((t) => ({ date: t.date, name: t.name, amount: t.amount, account_id: accountId })),
  );
  const transactions = parsed.map((t, i) => ({ ...t, isDuplicate: duplicateFlags[i] ?? false }));
  const summary = {
    total: transactions.length,
    duplicates: transactions.filter((t) => t.isDuplicate).length,
    needsReview: transactions.filter((t) => t.needsReview).length,
  };
  const parseSuccessRate =
    totalDataRows > 0 ? Math.round((parsed.length / totalDataRows) * 1000) / 1000 : 0;

  return {
    transactions,
    summary,
    format: resolvedProfile,
    parseSuccessRate,
    errors,
  };
}
