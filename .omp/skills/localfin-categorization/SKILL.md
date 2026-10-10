---
name: localfin-categorization
description: Use when categorizing transactions from bank CSV statements
---

# LocalFin categorization (OMP session model only)

Server and scripts stay keyless and deterministic. `POST /api/parser/parse-statement` returns uncategorized rows (`{date, name, amount, kind, needsReview, isDuplicate, originalLine}`); categorization is never done server-side. The only model path is this skill, run in the OMP session.

## Trigger

Run only when the user invokes `/skill:localfin-categorization` or explicitly asks to categorize parsed CSV or uncategorized transactions. Never run silently on parse or ingest.

## Preconditions

Start from `POST /api/parser/parse-statement` (or `localfin_parse_statement`) output from a bank CSV ingest plus `GET /api/accounts` for `account.type`. Preserve each parsed row's `date/name/amount/kind`; do not recompute kind except for the transfer rule below.

## Lookup first

For each unknown, call `GET /api/transactions?searchQuery=` scoped by exact name and account (or `localfin_search_transactions`), applying `getRecentTransactionByNameAndAccount` semantics:

`WHERE name = ? AND account_id = ? AND deleted_at IS NULL AND (kind = 'transfer' OR subcategory_id IS NOT NULL) ORDER BY date DESC, created_at DESC LIMIT 20`: group the window by `(kind, subcategory_id)`; fewer than 3 rows falls back to the most recent row; otherwise reuse the most recent row of the majority key only when its share is >= 0.6, else treat as no hit.

No fuzzy match, no cross-account match. On a hit with a live subcategory id, reuse it and treat as `source:"lookup"` (`categorizationSource:"lookup"`), `ai_suggested:false`. Copy the existing `cleanName` behavior (strip leading `POS|ACH|CHECK|DEBIT|CREDIT|PURCHASE` and trailing `NNNNNN+` refs) before comparing; this is matching hygiene only.

## Transfer guard

Apply before any model call.

`PAYMENTISH_NAME_PATTERN = /\b(?:transfer|online transfer|credit card payment|payment thank you|autopay|ach payment|card payment|payment received|payment posted)\b/i`

A name matching the pattern with no fitting subcategory becomes `{kind:"transfer", subcategory_id:null}`. When unsure between transfer and income/expense, keep the parser kind from `inferTransactionKindForAccount(amount, accountType)` (`shared/finance/transactionAmounts.ts:27`; `amount===0` yields expense; liability inverts asset sign) rather than forcing transfer. Transfers and adjustments MUST have `subcategory_id:null` per `localfin-finance-invariants`.

## Choices and few-shot

Fetch `GET /api/subcategories` (or `localfin_list_subcategories`) as `{id, category_id, name, category_name, category_type}`. Build one shared Choice criteria map: label `"category > subcategory"` → rubric `"<category_type>: category > subcategory"`, plus `"Uncertain"` → `"No listed subcategory fits this transaction"`. Keep a local label→id table (never sent to the judge); labels stay verbatim. Never invent ids. Fetch `GET /api/transactions?limit=50` (or `localfin_search_transactions` with `limit:50`), preferring same-account or merchant-substring rows, as `{name, subcategory label, category}` triples for per-state examples (up to 5 per state).

## OMP execution

No external key; uses the eval kernel `judge` role (native TypeSafe Jev when credentialed, else the tiny/smol chat fallback through the same typed interface). Optional native Jev: declare a `judge`-role model in `~/.omp/agent/models.yml` with `api: typesafe` (TypeSafe direct, `TYPESAFE_API_KEY`) or `api: openrouter-decisions` (OpenRouter `typesafe/jev-1.13`, billed to OpenRouter). No sharding, no `workpool`, no JSON-schema parsing: `judge_batch` owns concurrency.

If unknown count after lookup is 0, stop. If 1 unknown, one `eval` `judge(state, questions)` call; if 2+, one batch call — JS `await judgeBatch(states, questions, { concurrency: 32, retries: 1, minOk: 1, intent: "Categorize" })`, Python `judge_batch(states, questions, concurrency=32, retries=1, min_ok=1, intent="Categorize")` — then `drain` in bounded slices until done (JS `await b.drain({ timeout })` yields `[[key, {key, answers, model}], ...]`; Python `await b.drain(timeout)` yields `[(key, item)]`). No custom tool in `.omp/tools` and no new server endpoint; MCP/REST already covers reads and writes.

`states` is `{key: state}` keyed by parsed-row index (or transaction id for already-created rows). Each state is `{name, amount, date, account_name, account_type, parser_kind, paymentish_name_match, examples}` where `paymentish_name_match` is the Transfer-guard regex result for that name and `examples` holds up to 5 `{name, subcategory label}` triples. Per-transaction context lives in the state because `judge_batch` applies identical questions to every state.

`questions` (identical for every state):
- `txn_kind`: `{type:"choice", instructions:"Classify this bank transaction. Transfer means money moving between the user's own accounts (credit card payment, autopay, account-to-account); when unsure between transfer and income/expense, answer the parser kind given in the state.", criteria:{income:"Money coming in: payroll, refunds, interest", expense:"Money going out: purchases, bills, fees", transfer:"Payment between own accounts; payment-like name"}}`
- `subcategory`: `{type:"choice", instructions:"Which subcategory best fits this transaction? Answer Uncertain when nothing fits; never answer a subcategory whose category type contradicts the transaction kind.", criteria:<shared map>}`

Decide per key with default threshold 0.6 (tune on a small labeled sample; probabilities make re-tuning free):
- Transfer-guard regex hit OR `txn_kind.choice==="transfer"` with confidence ≥ 0.6 → `{kind:"transfer", subcategory_id:null}`.
- `txn_kind.choice` income/expense with confidence ≥ 0.6 → that kind; else keep `parser_kind` (never force transfer on low confidence).
- Subcategory: accept the label only when it is not `Uncertain`, confidence ≥ 0.6, the label maps to a live id, and its `category_type` matches the final kind; else `null`. Transfer forces `null`.

On per-key `item.error`, mark exactly those inputs `categorizationSource:"none"`, `subcategory_id:null`, and continue. If `drain` raises wholesale (fewer than `min_ok` answered), mark all remaining the same, keep lookup results, and surface leftovers via `needsCategory` / ODS export instead of failing the ingest.

## Validation

Require both `txn_kind` and `subcategory` answers per key; a missing answer marks that input `categorizationSource:"none"`, `subcategory_id:null`. Map labels to ids through the local table only (an unmapped label becomes `null`, never a guess); force `subcategory_id:null` when final kind is `transfer`; null out a subcategory whose `category_type` contradicts the final kind. Leave still-unknown income/expense rows `subcategory_id:null` for `needsCategory` rather than guessing. Tags stay explicit-only (set only on the words `tag` / `tagged` or `tag it as X` per `localfin-finance-invariants`).

## Write

For not-yet-created rows call `POST /api/transactions/bulk` (or `localfin_bulk_create_transactions`, max 500 per call) with `{account_id, date, name, amount, kind, subcategory_id, tag_ids:[], comment?, ai_suggested}` where `ai_suggested:true` only for model-chosen rows and `false` for lookup rows (`ai_suggested` lives on `Transaction` writes only). For already-created rows call `PUT /api/transactions/bulk` (or `localfin_bulk_update_transactions`) with `{ids, updates:{subcategory_id, ai_suggested:true}}` for model-chosen rows only. Handle 409 duplicate-name partial failures per `localfin-workflows` (valid rows persist; report invalid rows with their error; do not retry successes).

## Verify

Re-query `GET /api/transactions?needsCategory=true` (or search) and show remaining `Unassigned` rows; the ODS human loop (`categorize:export` / `categorize:apply`) stays the review surface for leftovers.
