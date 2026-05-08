# Agent Failed-Action Recovery

## Summary

Implement recoverable failed-action retry for the assistant loop so a failed action can be fed back into a follow-up LLM turn with the error and prior successful actions. Harden account/category/subcategory reference handling so user-provided names are not blindly treated as IDs.

## Key Changes

- Create worktree branch `feature/agent-failed-action-recovery` from `main`.
- Update assistant instructions to require IDs from provided context, or name fields when the user provides names.
- Do not add list/search tools for accounts, categories, or subcategories because they are already in assistant context.
- Validate all account/category/subcategory ID references before writes.
- Normalize `*_id` values that uniquely match an entity name; fail with candidate IDs when ambiguous.
- Continue the tool loop after recoverable failed actions, including prior action errors in follow-up context.
- Suppress exact repeats of already successful actions on follow-up turns.

## Test Plan

- Add unit coverage for name-in-ID normalization, invalid ID rejection, ambiguous references, and recoverable retry decisions.
- Add a live eval scenario that reproduces the original bulk update failure shape.
- Run `npm run test`, `npm run typecheck`, and `npm run lint`.

## Assumptions

- Retry scope is recoverable only, not every failed action.
- No frontend API shape changes are needed.
- Existing `maxAssistantTurns` controls retry limits.
