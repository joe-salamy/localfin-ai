# Agent Panel Collapse + Action Streaming

## Summary

Add a split assistant layout so opening the agent panel shrinks the app instead of covering it, and add a streaming chat endpoint so users see assistant action progress while work is happening.

## Key Changes

- Create branch `feature/agent-panel-streaming-ui` from the current feature branch state.
- Add `POST /api/ai/chat/stream` using server-sent events for assistant lifecycle and action execution events.
- Keep `POST /api/ai/chat` for compatibility and share the same parsing/execution logic.
- Move assistant open state into `AppLayout`; desktop uses a split layout and mobile uses a full-screen panel.
- Render live action progress in `ChatSidePanel` with spinning loading icons, success icons, and failure icons.

## Test Plan

- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Manually test desktop and mobile panel behavior.
- Manually test assistant answer-only, successful action, multiple actions, and failed action requests.

## Assumptions

- Streaming tool calls means streaming LocalFin action lifecycle events, not raw model token deltas.
- The non-streaming chat endpoint remains available as a fallback.
- OpenRouter native tool calling is out of scope for this change.
