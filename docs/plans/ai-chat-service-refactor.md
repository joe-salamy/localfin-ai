# AI Chat Service Refactor

## Summary

- Work on branch `feature/ai-chat-service-refactor` from `main` in worktree `..\localfin-ai-ai-chat-service-refactor`.
- Refactor `server/services/ai-chat.ts` from a 2,170-line god file into cohesive modules while preserving current API behavior, route imports, streamed events, action semantics, logs, and tests.

## Key Changes

- Keep `server/services/ai-chat.ts` as the stable public facade exporting the existing public surface: `ChatResult`, `ChatStreamEvent`, `normalizeMaxAssistantTurns`, `prepareActionsForExecution`, `buildSearchUpdateFollowUp`, `executeAction`, `actionFailureCanBeRetried`, `shouldContinueToolLoop`, `chatWithAssistant`, and `streamChatWithAssistant`.
- Add `server/services/ai-chat/` modules:
  - `types.ts` for chat/action/result/context types.
  - `constants.ts` for max-turn and bulk-limit constants.
  - `input-validators.ts` for scalar coercion, enum validation, ISO date/range validation, and small field helpers.
  - `entity-resolution.ts` for name/id lookup and account/category/subcategory/goal resolution.
  - `transaction-action-planning.ts` for transaction normalization, inferred actions, search-before-update repair, and follow-up construction.
  - `action-preparation.ts` for action cloning, duplicate/skipped action filtering, and the exported `prepareActionsForExecution`.
  - `action-executor.ts` for the `executeAction` switch and action-specific service calls.
  - `prompting.ts` for `assistantSystemMessage`, compact context, response parsing, and prompt JSON construction.
  - `chat-runner.ts` for OpenRouter calls, tool-loop continuation, streaming event emission, conversation persistence, and the exported chat entrypoints.
- Preserve existing import paths outside the refactor; `server/routes/ai.ts` should continue importing from `../services/ai-chat.js`.
- Avoid behavioral rewrites during extraction. Only apply local readability cleanup where it is clearly mechanical, such as early returns, clearer helper names, and removing duplication introduced by the split.

## Test Plan

- Add focused server tests for pure behavior that is currently embedded in the god file:
  - `normalizeMaxAssistantTurns` defaulting and clamp behavior.
  - `shouldContinueToolLoop` search-follow-up and retriable-failure decisions.
  - `actionFailureCanBeRetried` matching known resolution errors.
  - `prepareActionsForExecution` preserving search-before-update and transaction normalization behavior.
- Keep existing integration coverage in `server/agent-system.test.ts` unchanged.
- Run `npm run test`, `npm run typecheck`, and `npm run lint` in the worktree.
- Commit the completed refactor on `feature/ai-chat-service-refactor`; do not merge to `main`.

## Assumptions

- This is a behavior-preserving refactor only; no new tool actions, prompt contract changes, API response changes, database changes, or frontend changes.
- Internal modules may export helpers for focused server tests, but the stable external service entrypoint remains `server/services/ai-chat.ts`.
- `scratchpad.md` remains untouched: do not read, write, or diff it.
