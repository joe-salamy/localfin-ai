---
name: localfin-categorization
description: Use when categorizing transactions from statements or pasting
---

# LocalFin categorization (OMP session model only)

Server and scripts stay keyless and deterministic. `POST /api/parser/parse-statement` always returns `subcategory_id:null`, `categorizationSource:"none"`, `summary:{fromLookup:0, fromAI:0}`. The only model path is this skill, run in the OMP session.

## Trigger

Run only when the user invokes `/skill:localfin-categorization` or explicitly asks to categorize pasted, parsed, or uncategorized transactions. Never run silently on parse or ingest.

## Preconditions

Start from `POST /api/parser/parse-statement` (or `localfin_parse_statement`) output plus `GET /api/accounts` for `account.type`. Preserve each parsed row's `date/name/amount/kind`; do not recompute kind except for the transfer rule below.

## Lookup first

For each unknown, call `GET /api/transactions?searchQuery=` scoped by exact name and account (or `localfin_search_transactions`), applying `getRecentTransactionByNameAndAccount` semantics:

`WHERE name = ? AND account_id = ? AND deleted_at IS NULL AND (kind = 'transfer' OR subcategory_id IS NOT NULL) ORDER BY date DESC, created_at DESC LIMIT 20`: group the window by `(kind, subcategory_id)`; fewer than 3 rows falls back to the most recent row; otherwise reuse the most recent row of the majority key only when its share is >= 0.6, else treat as no hit.

No fuzzy match, no cross-account match. On a hit with a live subcategory id, reuse it and treat as `source:"lookup"` (`categorizationSource:"lookup"`), `ai_suggested:false`. Copy the existing `cleanName` behavior (strip leading `POS|ACH|CHECK|DEBIT|CREDIT|PURCHASE` and trailing `NNNNNN+` refs) before comparing; this is matching hygiene only.

## Transfer guard

Apply before any model call.

`PAYMENTISH_NAME_PATTERN = /\b(?:transfer|online transfer|credit card payment|payment thank you|autopay|ach payment|card payment|payment received|payment posted)\b/i`

A name matching the pattern with no fitting subcategory becomes `{kind:"transfer", subcategory_id:null}`. When unsure between transfer and income/expense, keep the parser kind from `inferTransactionKindForAccount(amount, accountType)` (`shared/finance/transactionAmounts.ts:27`; `amount===0` yields expense; liability inverts asset sign) rather than forcing transfer. Transfers and adjustments MUST have `subcategory_id:null` per `localfin-finance-invariants`.

## Choices and few-shot

Fetch `GET /api/subcategories` (or `localfin_list_subcategories`) as `{id, category_id, name, category_name, category_type}` and present verbatim as `category > subcategory (id)` lines. Fetch `GET /api/transactions?limit=50` (or `localfin_search_transactions` with `limit:50`), preferring same-account or merchant-substring rows, as `{name, subcategory_name, category_name}` pairs. Never invent ids.

## OMP execution

No external key; uses the session model from `~/.omp/agent/models.yml` provider routing. Shard size 25 is a context-window convenience, not a server limit.

If unknown count after lookup is 0, stop.

If 1–25 unknowns, one `eval` `completion(prompt, {system, schema})` call (JS) or `completion(prompt, system=..., schema=...)` (Python) with the JSON schema `{"type":"object","properties":{"results":{"type":"array","maxItems":25,"items":{"type":"object","properties":{"kind":{"enum":["income","expense","transfer"]},"subcategory_id":{"type":["string","null"]}},"required":["kind","subcategory_id"],"additionalProperties":false}}},"required":["results"],"additionalProperties":false}`. System content MUST embed the transfer rule, the verbatim choices, the few-shot pairs, and the order rule (one result per input, input order).

If 26+ unknowns, shard into items of exactly 25 (last shard 1–25) and run `eval` `workpool(agent=None, name="categorize", context=<same system content>, tools=None)` with `eval.workpool.freshAgents=true`, `.push(*items)` where each item is `{transactions:[{id,name,amount,date,account_id,kind}], choices, examples}`; each worker returns `yield({key, data:{results:[...]}})` or `yield({key, error})` per the `omp://tools/eval.md` contract. No custom tool in `.omp/tools` and no new server endpoint; MCP/REST already covers reads and writes.

If the session model rejects 25 items, halve to 12 and retry once, then leave failures as `categorizationSource:"none"` and surface them via `needsCategory` / ODS export. If model auth is unavailable mid-run, skip the model step, keep lookup results, and export leftovers instead of failing the ingest.

## Validation

Require `results.length === inputs.length` per batch; reject non-object entries and numeric-choice hallucinations; filter every `subcategory_id` against the live choices fetched above (unknown id becomes `null`); force `subcategory_id:null` when `kind` is `transfer`; preserve parser `kind` for non-transfer rows unless the model returns transfer under the guard above. On `completion` `.wait()` failure or a worker `error`, mark exactly those inputs `categorizationSource:"none"`, `subcategory_id:null`, and continue remaining batches. Leave still-unknown income/expense rows `subcategory_id:null` for `needsCategory` rather than guessing. Tags stay explicit-only (set only on the words `tag` / `tagged` or `tag it as X` per `localfin-finance-invariants`).

## Write

For not-yet-created rows call `POST /api/transactions/bulk` (or `localfin_bulk_create_transactions`, max 500 per call) with `{account_id, date, name, amount, kind, subcategory_id, tag_ids:[], comment?, ai_suggested}` where `ai_suggested:true` only for model-chosen rows and `false` for lookup rows (`ai_suggested` lives on `Transaction` writes only). For already-created rows call `PUT /api/transactions/bulk` (or `localfin_bulk_update_transactions`) with `{ids, updates:{subcategory_id, ai_suggested:true}}` for model-chosen rows only. Handle 409 duplicate-name partial failures per `localfin-workflows` (valid rows persist; report invalid rows with their error; do not retry successes).

## Verify

Re-query `GET /api/transactions?needsCategory=true` (or search) and show remaining `Unassigned` rows; the ODS human loop (`categorize:export` / `categorize:apply`) stays the review surface for leftovers.
