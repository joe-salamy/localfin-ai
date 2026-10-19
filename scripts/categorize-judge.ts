// Deterministic halves of the OMP model-categorization loop (see
// .omp/skills/localfin-categorization): `prepare` writes the judge_batch
// input for every transaction still needing a category; `apply` turns the
// batch results into updates (ai_suggested) and exports the leftovers.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { getAccounts } from "../server/services/accounts.js";
import { getCategories, getSubcategories } from "../server/services/categories.js";
import { localIsoDate } from "../server/services/dates.js";
import { bulkUpdateTransactions } from "../server/services/transactions/bulk.js";
import { getTransactionsWithDetails } from "../server/services/transactions/read.js";
import type { TransactionKind } from "../shared/contracts/index.js";
import { merchantKey, merchantKeysMatch } from "../shared/finance/merchantNames.js";
import { DOWNLOADS_DIRECTORY } from "./user-paths.js";
import { exportCategorizeOds } from "./export-categorize-ods.js";

const WORK_DIR = path.resolve("logs", "categorize");
export const DEFAULT_INPUT = path.join(WORK_DIR, "judge-input.json");
export const DEFAULT_RESULTS = path.join(WORK_DIR, "judge-results.json");
const JSONL_DIR = path.resolve("logs", "jsonl");
export const DEFAULT_THRESHOLD = 0.6;
const UNCERTAIN = "Uncertain";
const MAX_EXAMPLES = 5;

export const PAYMENTISH_NAME_PATTERN =
  /\b(?:transfer|online transfer|credit card payment|payment thank you|autopay|ach payment|card payment|payment received|payment posted)\b/i;

// ---------- Input file ----------

const labelSchema = z.object({ id: z.string(), type: z.enum(["income", "expense"]) });
const stateSchema = z.object({
  name: z.string(),
  amount: z.number(),
  date: z.string(),
  account_name: z.string(),
  account_type: z.enum(["asset", "liability"]),
  parser_kind: z.enum(["income", "expense"]),
  paymentish_name_match: z.boolean(),
  examples: z.array(z.object({ name: z.string(), subcategory: z.string() })),
});
const judgeInputSchema = z.object({
  created_at: z.string(),
  labels: z.record(z.string(), labelSchema),
  questions: z.record(z.string(), z.unknown()),
  states: z.record(z.string(), stateSchema),
});
export type JudgeInput = z.infer<typeof judgeInputSchema>;
export type JudgeState = z.infer<typeof stateSchema>;
type Labels = JudgeInput["labels"];
const choiceAnswerSchema = z.object({
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

// judge_batch `results()`: {key: {questionId: answer}}; failed keys are absent.
const judgeResultsSchema = z.record(
  z.string(),
  z.object({ txn_kind: choiceAnswerSchema.optional(), subcategory: choiceAnswerSchema.optional() }),
);
export type JudgeAnswers = z.infer<typeof judgeResultsSchema>[string];

function buildQuestions(labels: Labels): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const [label, { type }] of Object.entries(labels)) criteria[label] = `${type}: ${label}`;
  criteria[UNCERTAIN] = "No listed subcategory fits this transaction";
  return {
    txn_kind: {
      type: "choice",
      instructions:
        "Classify this bank transaction. Transfer means money moving between the user's own accounts (credit card payment, autopay, account-to-account); when unsure between transfer and income/expense, answer the parser kind given in the state.",
      criteria: {
        income: "Money coming in: payroll, refunds, interest",
        expense: "Money going out: purchases, bills, fees",
        transfer: "Payment between own accounts; payment-like name",
      },
    },
    subcategory: {
      type: "choice",
      instructions:
        "Which subcategory best fits this transaction? Prefer the subcategory the examples (the user's own past labels for similar merchants) use. Answer Uncertain when nothing fits; never answer a subcategory whose category type contradicts the transaction kind.",
      criteria,
    },
  };
}

function nameTokens(name: string): string[] {
  return [...new Set(name.toUpperCase().split(/[^A-Z]+/).filter((token) => token.length >= 4))];
}

/** Builds the judge_batch input for every income/expense transaction without a subcategory. */
export function buildJudgeInput(now = new Date()): JudgeInput {
  void getDb();
  const categories = new Map(getCategories().map((c) => [c.id, c] as const));
  const labels: Labels = {};
  const labelById = new Map<string, string>();
  for (const s of getSubcategories()) {
    const category = categories.get(s.category_id);
    // System "Unassigned" rows are the absence of a category; "Uncertain" covers it.
    if (!category || s.is_system) continue;
    const label = `${category.name} > ${s.name}`;
    labels[label] = { id: s.id, type: category.type };
    labelById.set(s.id, label);
  }
  const accountType = new Map(getAccounts().map((a) => [a.id, a.type] as const));

  const pending = getTransactionsWithDetails({ needsCategory: true }).filter(
    (t) => !t.is_initial_balance && t.deleted_at == null && (t.kind === "income" || t.kind === "expense"),
  );
  const history = getTransactionsWithDetails({})
    .filter((t) => t.deleted_at == null && t.subcategory_id != null && labelById.has(t.subcategory_id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({
      name: t.name,
      account_id: t.account_id,
      label: labelById.get(t.subcategory_id as string) as string,
      key: merchantKey(t.name),
      tokens: nameTokens(t.name),
    }));
  // Tokens on more than 5% of history (city names, "PURCHASE") say nothing about the merchant.
  const documentFrequency = new Map<string, number>();
  for (const h of history) for (const token of h.tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  const commonCutoff = Math.max(5, history.length * 0.05);

  const states: JudgeInput["states"] = {};
  for (const t of pending) {
    const key = merchantKey(t.name);
    const tokens = nameTokens(t.name).filter((token) => (documentFrequency.get(token) ?? 0) <= commonCutoff);
    const scored: Array<{ score: number; name: string; subcategory: string }> = [];
    for (const h of history) {
      let score = merchantKeysMatch(key, h.key) ? 4 : 0;
      for (const token of tokens) if (h.tokens.includes(token)) score += 1;
      if (score === 0) continue;
      if (h.account_id === t.account_id) score += 1;
      scored.push({ score, name: h.name, subcategory: h.label });
    }
    // Stable sort keeps the most recent example first among equal scores.
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const examples: JudgeState["examples"] = [];
    for (const s of scored) {
      const id = `${s.name}|${s.subcategory}`;
      if (seen.has(id)) continue;
      seen.add(id);
      examples.push({ name: s.name, subcategory: s.subcategory });
      if (examples.length === MAX_EXAMPLES) break;
    }
    states[t.id] = {
      name: t.name,
      amount: t.amount,
      date: t.date,
      account_name: t.account_name ?? t.account_id,
      account_type: accountType.get(t.account_id) ?? "asset",
      parser_kind: t.kind as "income" | "expense",
      paymentish_name_match: PAYMENTISH_NAME_PATTERN.test(t.name),
      examples,
    };
  }
  return { created_at: now.toISOString(), labels, questions: buildQuestions(labels), states };
}

// ---------- Decisions ----------

export type JudgeDecision =
  | { action: "categorize"; kind: "income" | "expense"; subcategoryId: string; label: string; confidence: number }
  | { action: "transfer" }
  | { action: "review"; reason: string; guess: string | null };

/**
 * Applies the skill's acceptance rules to one judged state:
 * - model says transfer at >= threshold → transfer (subcategory null);
 * - kind = model income/expense at >= threshold, else the parser kind;
 * - subcategory accepted when not Uncertain, >= threshold, a known label,
 *   and its category type equals the kind;
 * - otherwise a payment-like name becomes a transfer, anything else is left
 *   for human review.
 */
export function decideJudgment(
  state: JudgeState,
  answers: JudgeAnswers | undefined,
  labels: Labels,
  threshold: number,
): JudgeDecision {
  const kindAnswer = answers?.txn_kind;
  const subAnswer = answers?.subcategory;
  if (!kindAnswer || !subAnswer) return { action: "review", reason: "missing answer", guess: null };
  if (kindAnswer.choice === "transfer" && kindAnswer.confidence >= threshold) return { action: "transfer" };

  const kind: "income" | "expense" =
    (kindAnswer.choice === "income" || kindAnswer.choice === "expense") && kindAnswer.confidence >= threshold
      ? kindAnswer.choice
      : state.parser_kind;
  const label = labels[subAnswer.choice];
  // For an Uncertain answer, still show the most likely same-kind label to the reviewer.
  const [guessLabel, guessConfidence] =
    subAnswer.choice !== UNCERTAIN
      ? [subAnswer.choice, subAnswer.confidence]
      : (Object.entries(subAnswer.probabilities ?? {})
          .filter(([candidate]) => labels[candidate]?.type === kind)
          .sort((a, b) => b[1] - a[1])[0] ?? [null, 0]);
  const guess = guessLabel == null ? null : `${guessLabel} (${guessConfidence.toFixed(2)})`;
  if (subAnswer.choice !== UNCERTAIN && subAnswer.confidence >= threshold && label) {
    if (label.type === kind) {
      return { action: "categorize", kind, subcategoryId: label.id, label: subAnswer.choice, confidence: subAnswer.confidence };
    }
    if (state.paymentish_name_match) return { action: "transfer" };
    return { action: "review", reason: `${label.type} label on ${kind} row`, guess };
  }
  if (state.paymentish_name_match) return { action: "transfer" };
  return { action: "review", reason: subAnswer.choice === UNCERTAIN ? "uncertain" : "low confidence", guess };
}

// ---------- Apply ----------

export interface ApplyJudgmentsResult {
  categorized: number;
  transfers: number;
  review: string[];
  stale: number;
  reviewPath: string | null;
}

export async function applyJudgments(options: {
  input: JudgeInput;
  results: Record<string, JudgeAnswers>;
  threshold: number;
  dryRun: boolean;
  out: string;
  /** JSONL audit directory; tests point it at a temp dir. */
  logDirectory?: string;
}): Promise<ApplyJudgmentsResult> {
  const { input, results, threshold, dryRun } = options;
  const db = getDb();
  const ids = Object.keys(input.states);
  const stillPending = new Set(
    getTransactionsWithDetails({ needsCategory: true })
      .filter((t) => t.deleted_at == null && (t.kind === "income" || t.kind === "expense"))
      .map((t) => t.id),
  );

  const groups = new Map<string, { kind: TransactionKind; subcategoryId: string | null; ids: string[] }>();
  const labelCounts = new Map<string, number>();
  const logRows: Array<Record<string, unknown>> = [];
  const review: string[] = [];
  const reviewLines: string[] = [];
  let categorized = 0;
  let transfers = 0;
  let stale = 0;
  for (const id of ids) {
    const state = input.states[id] as JudgeState;
    if (!stillPending.has(id)) {
      stale += 1;
      continue;
    }
    const decision = decideJudgment(state, results[id], input.labels, threshold);
    if (decision.action === "review") {
      review.push(id);
      reviewLines.push(`  ${state.date} ${state.account_name.slice(0, 24)} | ${state.name} | ${state.amount} | ${decision.reason}${decision.guess ? ` → ${decision.guess}` : ""}`);
      logRows.push({ id, action: "review", reason: decision.reason, guess: decision.guess });
      continue;
    }
    const kind: TransactionKind = decision.action === "transfer" ? "transfer" : decision.kind;
    const subcategoryId = decision.action === "transfer" ? null : decision.subcategoryId;
    const groupKey = `${kind}::${subcategoryId ?? ""}`;
    const group = groups.get(groupKey) ?? { kind, subcategoryId, ids: [] };
    group.ids.push(id);
    groups.set(groupKey, group);
    if (decision.action === "transfer") {
      transfers += 1;
      logRows.push({ id, action: "transfer" });
    } else {
      categorized += 1;
      labelCounts.set(decision.label, (labelCounts.get(decision.label) ?? 0) + 1);
      logRows.push({ id, action: "categorize", label: decision.label, confidence: decision.confidence });
    }
  }

  const verb = dryRun ? "Would categorize" : "Categorized";
  console.log(`${verb} ${categorized}, transfers ${transfers}, review ${review.length}, stale ${stale} (threshold ${threshold})`);
  for (const [label, count] of [...labelCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${label}`);
  if (reviewLines.length > 0) {
    console.log("Needs review (reason → model's best guess):");
    for (const line of reviewLines) console.log(line);
  }
  if (dryRun) return { categorized, transfers, review, stale, reviewPath: null };

  db.transaction(() => {
    for (const group of groups.values()) {
      bulkUpdateTransactions(group.ids, { kind: group.kind, subcategory_id: group.subcategoryId, ai_suggested: true });
    }
  })();

  const now = new Date();
  const logDirectory = options.logDirectory ?? JSONL_DIR;
  mkdirSync(logDirectory, { recursive: true });
  appendFileSync(
    path.join(logDirectory, `categorize-${localIsoDate(now)}.jsonl`),
    `${JSON.stringify({
      timestamp: now.toISOString(),
      operation: "categorize.judgments",
      threshold,
      categorized,
      transfers,
      review: review.length,
      stale,
      rows: logRows,
    })}\n`,
    "utf8",
  );

  let reviewPath: string | null = null;
  if (review.length > 0) {
    const exported = await exportCategorizeOds({ out: options.out, needsCategoryOnly: true, limit: null, ids: review });
    reviewPath = exported.path;
    console.log(`Wrote ${exported.path} (${exported.exported} rows needing review)`);
  }
  return { categorized, transfers, review, stale, reviewPath };
}

// ---------- CLI ----------

export function judgeUsage(): string {
  return [
    "Usage: categorize:prepare [--out judge-input.json]",
    "       categorize:apply-judgments [--input judge-input.json] [--results judge-results.json] [--threshold 0.6] [--out review.fods] [--dry-run]",
    `Defaults: ${path.relative(process.cwd(), DEFAULT_INPUT)}, ${path.relative(process.cwd(), DEFAULT_RESULTS)}, ~/Downloads/categorize-review.fods`,
  ].join("\n");
}

type JudgeCommand =
  | { command: "prepare"; out: string }
  | { command: "apply"; input: string; results: string; threshold: number; out: string; dryRun: boolean };

export function parseJudgeArgs(argv: string[]): JudgeCommand | null {
  const [command, ...rest] = argv;
  const values = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (arg === "--dry-run" && command === "apply" && !dryRun) {
      dryRun = true;
      continue;
    }
    const allowed = command === "prepare" ? ["--out"] : ["--input", "--results", "--threshold", "--out"];
    const value = rest[i + 1];
    if (!allowed.includes(arg) || values.has(arg) || value == null || value.startsWith("--")) return null;
    values.set(arg, value);
    i += 1;
  }
  if (command === "prepare") return { command, out: path.resolve(values.get("--out") ?? DEFAULT_INPUT) };
  if (command !== "apply") return null;
  const threshold = Number(values.get("--threshold") ?? DEFAULT_THRESHOLD);
  if (!(threshold > 0 && threshold <= 1)) return null;
  return {
    command,
    input: path.resolve(values.get("--input") ?? DEFAULT_INPUT),
    results: path.resolve(values.get("--results") ?? DEFAULT_RESULTS),
    threshold,
    out: path.resolve(values.get("--out") ?? path.join(DOWNLOADS_DIRECTORY, "categorize-review.fods")),
    dryRun,
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const parsed = parseJudgeArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(judgeUsage());
    process.exitCode = 2;
    return;
  }
  try {
    if (parsed.command === "prepare") {
      const input = buildJudgeInput();
      const count = Object.keys(input.states).length;
      if (count === 0) {
        console.log("Nothing needs a category.");
        return;
      }
      mkdirSync(path.dirname(parsed.out), { recursive: true });
      writeFileSync(parsed.out, `${JSON.stringify(input, null, 1)}\n`, "utf8");
      console.log(`Wrote ${count} states, ${Object.keys(input.labels).length} labels to ${parsed.out}`);
      return;
    }
    const input = judgeInputSchema.parse(readJson(parsed.input));
    const results = judgeResultsSchema.parse(readJson(parsed.results));
    const unknown = Object.keys(results).filter((id) => !(id in input.states));
    if (unknown.length > 0) throw new Error(`${unknown.length} result keys are not in ${parsed.input}; re-run categorize:prepare and the batch.`);
    await applyJudgments({ input, results, threshold: parsed.threshold, dryRun: parsed.dryRun, out: parsed.out });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
