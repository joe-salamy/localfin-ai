# Agent Tool Loop And Bulk Transaction Updates

## Summary
- First implementation step: create worktree branch `feature/agent-tool-loop-bulk-update` from `main`, and save this plan as `docs/plans/agent-tool-loop-bulk-update.md`.
- Implement both improvements together: a configurable assistant tool loop for search-result follow-up reasoning, plus a deterministic `bulk_update_transactions` action for "all matching transactions" requests.
- Add a Settings toggle for max assistant LLM turns per user request. Default is `5`; valid range is `1-10`.

## Key Changes
- Add assistant action type:
  `bulk_update_transactions: { searchQuery, account_id? or account_name?, subcategory_id? or subcategory_name?, startDate?, endDate?, limit?, updates: { subcategory_id? or subcategory_name?, comment? } }`
- In `server/services/ai-chat.ts`, execute `bulk_update_transactions` by resolving filters, searching matching transactions, resolving update fields, and updating every matched active transaction.
- Use existing transaction search semantics and account/subcategory resolution. Cap assistant bulk matches at `100` by default unless `limit` is provided, with a hard cap of `500`.
- Return action result with `{ matched_count, updated_count, transaction_ids }`; zero matches is a successful no-op with counts of `0`.

## Agent Loop And Settings
- Replace the fixed one-shot assistant planning call with up to `N` LLM turns per user request, where `N` comes from request settings.
- Add `maxAssistantTurns?: number` to chat requests in frontend and backend schemas. Server default is `5`, clamped to `1-10`.
- Persist the setting client-side in localStorage via a small assistant settings hook/storage module, and add a numeric control on `SettingsPage`.
- Send `maxAssistantTurns` from `useAI` for both `/ai/chat` and `/ai/chat/stream`.
- After executing actions, if any `search_transactions` action ran and no create/update/bulk action completed the requested mutation, call the model again with compact tool results and ask for final follow-up actions or a final answer.
- Keep streaming events compatible: emit `actions_planned`, `action_started`, and `action_finished` for each loop iteration; final result contains all executed actions in order.

## Prompt And Behavior
- Update the system prompt to prefer `bulk_update_transactions` when the user says "all matching," "every," "all transactions with," or gives a search criterion plus a uniform update.
- Keep `search_transactions` for read-only searches and ambiguous "find then decide" requests.
- Keep `update_transaction` for known IDs or single selected transactions.
- For multiple independent bulk criteria in one user request, emit one `bulk_update_transactions` action per criterion.
- Keep the existing deterministic search-only repair as a fallback during the transition, but prefer the model loop and bulk action for new behavior.

## Tests
- Add unit tests for:
  - `maxAssistantTurns` defaulting/clamping,
  - request schema accepts the optional setting,
  - bulk action execution updates every search match,
  - zero-match bulk update returns success counts without mutation,
  - search-only first model turn can continue into a follow-up update turn.
- Add live eval cases for:
  - two independent bulk subcategory updates in one prompt,
  - "all ZELLE INSTANT PMT" updates multiple matches,
  - changing max assistant turns does not break streaming lifecycle events.
- Verify with `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run eval:agent:live`.

## Assumptions
- `bulk_update_transactions` is an assistant action only; no new public REST transaction route is required.
- The loop limit setting is a local browser preference, with server-side default/clamping for safety.
- Bulk assistant updates may change `subcategory` and `comment`; date/name/amount remain single-row update fields for now.
- The implementation should not read, write, or diff `scratchpad.md`.
