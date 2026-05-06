# Frontend AI Assistant + Local LLM Observability Plan

## Summary

Implement a frontend AI experience covering categorization workflows and assistant chat, plus backend JSONL observability for every OpenRouter call. LLM logs are local-only under `logs/`, grouped by `conversationId` or workflow `runId`.

## Key Changes

- Add AI categorization controls for transaction input rows, statement paste/import using `/api/parser/parse-statement`, confidence/source display, and correction saving.
- Add an assistant surface that can answer finance questions and directly create/update accounts, categories, subcategories, goals, and transactions through backend-controlled actions.
- Add `/api/ai/chat` with `conversationId`, user message, page context, assistant response, performed actions, and log metadata.
- Wrap OpenRouter calls with JSONL logging. Each event records request metadata, full prompts/responses, parsed output when available, duration, status, errors, model, and usage if returned. API keys and auth headers are never logged.
- Generate one frontend run id per categorization or statement import workflow so multi-batch LLM calls append to the same `logs/<runId>.jsonl`.

## Test Plan

- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Manually test categorization, correction saving, statement parsing, assistant create/update actions, multi-batch JSONL grouping, and failed OpenRouter logging.

## Assumptions

- Full prompt/response logging is enabled for local debugging.
- Logs remain local files and are not browsed/downloaded from the frontend in v1.
- Chat direct actions are limited to create/update operations; deletion remains out of scope.
