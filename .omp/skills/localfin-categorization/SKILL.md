---
name: localfin-categorization
description: Use when categorizing transactions from statements or pasting
---

# LocalFin Categorization

Replaces `server/services/ai.ts:91 categorizeTransactions`, `server/services/parser.ts:6 categorizeTransactions`, and `server/ai/model.ts` OpenRouter flow. Use this heuristic + LLM skill in external agents; server `POST /api/parser/parse-statement` is now deterministic only (format detection, `parseDate`, `parseAmount`, `cleanName`, `checkDuplicatesInDb`; `enrichedTransactions` have `subcategory_id: null` unless exact lookup matched; `ai_suggested: false`).

## Transfer detection (no subcategory)

From `server/services/ai.ts:69 PAYMENTISH_NAME_PATTERN` and `isLikelyTransfer` (`ai.ts:469`):

- `PAYMENTISH_NAME_PATTERN = /\b(?:transfer|online transfer|credit card payment|payment thank you|autopay|ach payment|card payment|payment received|payment posted)\b/i`
- `isLikelyTransfer(tx, batchTransactions)` also checks paired opposite amounts within batch and `amount` sign vs account type. **Transfers must have `subcategory_id: null` and `kind: "transfer"`**; never assign a category to them.
- If a name matches the pattern and no subcategory fits, classify as transfer. If unsure, prefer `expense`/`income` via amount sign (see below) over transfer.

## Kind via amount sign

`amount` sign decides `income` vs `expense` via `inferTransactionKindForAccount` (`shared/finance/transactionAmounts.ts:27` → `server/services/ai.ts:462 getTransactionCategoryType`):

- Determine `account.type` (`asset`|`liability`) from `GET /api/accounts`.
- `inferTransactionKindForAccount(amount, accountType)` → `income`|`expense` (transfers already handled). Use `normalizeTransactionAmount(amount, accountType, kind)` to store the signed delta.

## Available choices

1. `GET /api/subcategories` (or `localfin_list_subcategories`) → each row is `buildAvailableSubcategoryChoices` shape (`server/services/ai.ts:405` returns `SubcategoryRow` copy): `{id, category_id, name, category_name, category_type, monthly_goal, color}`.
2. Format for LLM prompt via `formatAvailableSubcategories(choices)` (`ai.ts:411`) — list as `category > subcategory` with id; present choices verbatim to the external LLM so it picks an id, not a name.
3. Past examples: `GET /api/transactions?limit=50` (or `localfin_search_transactions` with `limit:50`) to fetch few-shot examples. Prefer recent transactions sharing the same account or merchant substring; include `{name, subcategory_name, category_name}` pairs.

## External LLM flow (bring your own key)

- Server no longer calls OpenRouter. External agent supplies its own LLM key (`OPENROUTER_API_KEY` no longer used by server; see `.env.example`).
- Build prompt from `buildCategorizationMessages(batch, availableChoices, pastExamples)` (`ai.ts:422`): system = instructions + available subcategories + past examples; user = batch of `TransactionForCategorization[]`.
- Batch size guidance: 25 per LLM call (`AI_CONFIG.batchSize:25`, `AI_CONFIG.maxConcurrentLLMRequests:5` — now advisory for external agent, not server). Process unknowns in batches; on LLM failure mark those as `source:"none"` and continue other batches.
- Validate LLM output with `categorizationSchema` (`ai.ts:87` strict object `{results: z.array({kind:z.enum(["income","expense","transfer"]), subcategory_id:z.string().nullable()}).max(25)}`): one result per input in order; reject numeric-choice hallucinations; filter `subcategory_id` to ids in `availableChoices`; unmatched ids become `Unassigned`.

## Fallbacks

- Exact-name lookup: `checkDuplicatesInDb` plus name-subcategory history (`server/services/ai.ts` lookup path) — if transaction name exactly matches a prior categorized transaction on same account, reuse its subcategory.
- `POS`/`ACH`/`CHECK` prefix stripping and trailing ref removal (`cleanName` `PREFIX_PATTERN`, `TRAILING_REF_PATTERN`) before matching.
- If still unknown after LLM/lookup, leave `subcategory_id: null` (`needsCategory=true` later) rather than guessing. Client can show `Unassigned` and let user pick via `GET /api/transactions?needsCategory=true`.

## Verify

- After categorization, call `POST /api/transactions/bulk` or `localfin_bulk_create_transactions` with resolved `kind`/`subcategory_id`; tags remain explicit-only (see `localfin-finance-invariants`).
- Audit of past categorization: query `GET /api/transactions?limit=100` and inspect `subcategory_name`/`category_name`; rerun this skill on `needsCategory` results.
