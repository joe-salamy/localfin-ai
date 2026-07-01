---
name: localfin-react-query-ui
description: Use when changing React pages, feature providers, hooks, query keys, Vite client behavior, or frontend data cache invalidation in LocalFin AI.
---

# LocalFin React Query UI

Use this skill for changes under `src/`, especially `src/pages/`, `src/features/`, `src/hooks/`, `src/lib/api.ts`, and `src/lib/queryKeys.ts`.

## Repo shape

- React 19 app entry: `src/main.tsx`, `src/App.tsx`, `src/Router.tsx`.
- Providers are nested in `src/App.tsx`: TanStack Query, shortcuts, undo/redo, display settings, flagged words, then router.
- API hooks live in `src/hooks/` and use `queryKeys` from `src/lib/queryKeys.ts`.
- Vite aliases `@` to `src` and proxies `/api` to `http://127.0.0.1:3001`.

## Workflow

1. Reuse existing hooks before adding new fetch logic in components.
2. Add or update query keys in `src/lib/queryKeys.ts` before using new query families.
3. After every mutation that changes persisted finance data, invalidate every affected root query family: usually `accounts`, `transactions`, `dashboard`, and the specific entity family.
4. Keep cached list defaults consistent with existing hooks: `select: (res) => res.data ?? []`; use `staleTime: Infinity` only for stable reference lists already following that convention.
5. Keep browser-persisted feature state under its feature directory, with tests beside storage/normalization logic.
6. Do not hardcode backend origins in UI code; call relative `/api/...` paths through `src/lib/api.ts`.

## Verification

- For hook/cache changes: run `npm run test:frontend` when tests exist for the touched feature; otherwise run the nearest frontend test file with `node --import tsx --test <path>`.
- Always run `npm run typecheck` for TS/TSX changes.
- Run `npm run lint` before yielding non-trivial UI changes.

## References

- React effects docs: https://react.dev/learn/synchronizing-with-effects
- TanStack Query invalidation docs: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations
- Vite server proxy docs: https://vite.dev/config/server-options.html#server-proxy
