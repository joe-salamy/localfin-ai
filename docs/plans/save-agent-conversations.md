# Save Agent Conversations

## Summary

- Create branch `feature/save-agent-conversations` from `main`.
- Add first-class SQLite persistence for assistant conversations so users can reopen prior chats inside `ChatSidePanel`, view saved messages/actions, and continue the same conversation.
- Keep JSONL logs as diagnostics only; do not backfill existing log files in v1.

## Key Changes

- Add SQLite tables for `agent_conversations` and `agent_messages`.
- Add conversation service and API support:
  - `GET /api/ai/conversations`
  - `GET /api/ai/conversations/:id/messages`
  - `POST /api/ai/conversations`
  - `DELETE /api/ai/conversations/:id`
- Persist user messages, final assistant messages, action results, and log file references from existing chat endpoints.
- Include recent prior user/assistant text from a saved conversation when continuing it.
- Update `ChatSidePanel` with a compact in-panel history list, new chat, select, and soft delete controls.

## Test Plan

- Run `npm run test`.
- Run `npm run lint`.
- Run `npm run typecheck`.
- Manually test creating, reopening, continuing, and soft-deleting assistant conversations.

## Assumptions

- Saved history is stored in SQLite; existing `logs/*.jsonl` files remain diagnostic.
- Reopened conversations can be continued.
- Persisted history includes user text, assistant final text, action results, and log file paths, but not reasoning streams.
