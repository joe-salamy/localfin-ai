---
name: localfin-categorization
description: Use for categorizing bank CSV statement transactions; not for live account feeds.
---

# LocalFin categorization (OMP session model only)

Scripts stay keyless and deterministic; the only model step is one eval `judge_batch` call in this session. Everything else is an npm script. Do not write ad-hoc SQL, `node -e`/`tsx -e` snippets, or `/tmp` scripts to read or write transactions.

## Trigger

Run when the user asks to categorize new/uncategorized transactions, or right after `ingest:inbox` / `ingest:csv` when they asked to "add and categorize". Never run silently on ingest alone.

## What ingest already did

`ingest:csv` / `ingest:inbox` reuse past subcategories deterministically (`createCategoryLookup`, `server/services/transactions/lookup.ts`):

1. exact name on the same account, majority >= 0.6 of the last 20 (fewer than 3 rows: most recent);
2. merchant key across all accounts (`merchantKey`, `shared/finance/merchantNames.ts`: bank boilerplate, wallet suffixes, digits stripped; first 8-16 letters compared), majority >= 0.8 of the last 20, at least 3 rows.

Only same-kind income/expense hits are reused. Do not repeat this lookup; whatever still has no subcategory goes to the model.

## Flow

1. `npm run categorize:prepare` → writes `logs/categorize/judge-input.json` (`{labels, questions, states}`) for every income/expense row without a subcategory, or prints `Nothing needs a category.` (stop). States carry `{name, amount, date, account_name, account_type, parser_kind, paymentish_name_match, examples}`; examples are up to 5 of the user's own labeled rows for similar merchants.
2. Run the batch in **Python** eval exactly like this (the JS handle's `status()`/`results()` are async and `drain_iter` does not exist there; a hand-rolled JS loop spun for 56 minutes once):

   ```python
   import json
   p = json.load(open("logs/categorize/judge-input.json"))
   b = judge_batch(p["states"], p["questions"], concurrency=32, retries=1, min_ok=1, intent="Categorize")
   while b.status()["running"]:
       await b.drain(30)
   print(b.status(), len(b.failed()))
   json.dump(b.results(), open("logs/categorize/judge-results.json", "w"))
   ```

   Failed keys are simply absent from `results()`; apply sends them to review. If `drain` raises (whole batch died), write `{}` to `judge-results.json` and continue: apply then sends every row to review.
3. `npm run categorize:apply-judgments -- --dry-run` → review the plan, then run it without `--dry-run`. Rules (`decideJudgment` in `scripts/categorize-judge.ts`, default threshold 0.6, `--threshold` to tune):
   - model `transfer` at >= threshold → `kind:"transfer"`, `subcategory_id:null`;
   - kind = model income/expense at >= threshold, else the parser kind;
   - subcategory accepted when not `Uncertain`, >= threshold, a known label, and its category type equals the kind;
   - otherwise a payment-like name (`PAYMENTISH_NAME_PATTERN`) becomes a transfer; everything else goes to review.

   Writes go through `bulkUpdateTransactions` with `ai_suggested:true`, skip rows that were categorized meanwhile ("stale"), log to `logs/jsonl/categorize-<date>.jsonl`, and export only the review rows to `~/Documents/LocalFin/inbox/categorize-review.fods`.
4. Report counts per label, transfers, and the review list printed by apply (each line shows the model's best guess). The user fills the sheet; then `npm run categorize:apply -- ~/Documents/LocalFin/inbox/categorize-review.fods --dry-run`, then without `--dry-run`. Rows a person labels there get `ai_suggested:false`.

## Invariants

- Transfers and adjustments have `subcategory_id:null` (`localfin-finance-invariants`).
- Never invent ids; labels map to ids only through the input file's `labels` table.
- Tags stay explicit-only.
- `categorize:export` exports only rows needing a category by default (`--all` for everything); always pass an explicit path inside `~/Documents/LocalFin/inbox/`, never `~/Inbox/` (bank CSV staging only).
