# Parallel Transaction Categorization Plan

## Summary
- Create branch `feature/parallel-ai-categorization` from `main` using `plan-worktree`, with worktree path `..\localfin-ai-parallel-ai-categorization`.
- Change AI transaction categorization so unresolved transactions, after correction and lookup matching, are split into LLM batches when `unknowns.length > AI_CONFIG.batchSize`.
- Process those LLM batches concurrently with a configurable limit, defaulting to 5, while returning results in the exact same order as the original request.

## Key Changes
- Add `maxConcurrentLLMRequests: 5` to `AI_CONFIG` in `server/config/app.ts`.
- Update `categorizeTransactions` in `server/services/ai.ts`:
  - Keep correction and historical lookup behavior unchanged.
  - Treat facts as unresolved `unknowns` sent to the LLM.
  - If `unknowns.length <= AI_CONFIG.batchSize`, make one LLM request.
  - If `unknowns.length > AI_CONFIG.batchSize`, chunk by `AI_CONFIG.batchSize` and process chunks through a local concurrency-limited async worker pool capped by `AI_CONFIG.maxConcurrentLLMRequests`.
  - Preserve order by writing every AI result back to `results[batch[j].index]`, where `batch[j].index` is the original transaction index.
  - Keep per-batch error handling isolated: a failed batch logs the error and leaves only that batch's transactions as `source: "none"`.

## Public Interfaces
- No API request or response shape changes for `POST /api/ai/categorize`.
- Internal config interface changes by adding `AI_CONFIG.maxConcurrentLLMRequests`.
- OpenRouter metadata continues to include `batchSize` and `unknownIndexes`, with `batchNumber` and `batchCount` added for log traceability.

## Test Plan
- Run `npm run typecheck`.
- Run `npm run lint`.
- Verify categorization ordering with more unknown transactions than `AI_CONFIG.batchSize`, out-of-order LLM completion, correction and lookup matches in mixed positions, and isolated handling of one failed LLM batch.

## Assumptions
- "Facts" means transactions that still need AI categorization after correction and historical lookup shortcuts.
- The concurrency setting belongs in `server/config/app.ts` as part of `AI_CONFIG`, not as a frontend/user setting or environment variable.
- Default concurrency is exactly 5.
- The implementation should use a local async worker-pool helper rather than adding a dependency.
