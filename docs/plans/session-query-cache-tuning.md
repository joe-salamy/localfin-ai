# Session Query Cache Tuning

## Summary
Implement a low-risk cache-only optimization so LocalFin feels snappier during an individual app session by keeping already-fetched data in TanStack Query memory longer and avoiding unnecessary local refetches.

First implementation step: create branch `feature/session-query-cache-tuning` from `main` in a worktree at `..\localfin-ai-session-query-cache-tuning`.

## Key Changes
- Update global TanStack Query defaults in `src/lib/queryClient.ts`:
  - Keep `staleTime: 5 * 60 * 1000`.
  - Add `gcTime: 60 * 60 * 1000` so inactive query results remain cached for one hour within a session.
  - Add `refetchOnWindowFocus: false` to prevent local data from refetching when switching back to the app.
  - Keep `retry: 1`.
- Add per-query freshness overrides for mostly-static local reference data:
  - Accounts query: `staleTime: Infinity`.
  - Categories query: `staleTime: Infinity`.
  - Subcategories query: `staleTime: Infinity`.
  - Rely on existing mutation invalidation to refresh these after create/update/delete.
- Do not change dashboard query structure, routing, backend endpoints, API response shapes, or persistence behavior in this pass.

## Public Interfaces
- No public API, route, schema, database, or type contract changes.
- Behavior change only: repeated navigation within the same browser session should reuse cached query data more often and show fewer loading states.

## Test Plan
- Run `npm run typecheck`.
- Run `npm run lint`.
- Manually verify in dev server:
  - Load dashboard, setup, and transaction history once.
  - Navigate away and back within several minutes; cached data should render immediately.
  - Switch browser focus away and back; no unnecessary refetch should occur solely from focus.
  - Create/update/delete an account/category/subcategory/transaction; affected data should refresh through existing invalidation.

## Assumptions
- Cache-only scope is intentional; route prefetching, route code-splitting, and dashboard endpoint consolidation are deferred.
- This is a single-user local-first app, so disabling focus refetch is acceptable.
- Reference data is only mutated through this app during normal use, making `staleTime: Infinity` safe when paired with existing invalidation.
