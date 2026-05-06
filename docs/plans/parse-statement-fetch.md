# Fix Parse Statement Fetch Failure

## Summary
- Implement in isolated worktree `..\law-essay-gen-fix-parse-statement-fetch` on branch `feature/fix-parse-statement-fetch`.
- Make the Add page Parse Statement flow work from both `http://localhost:5173` and `http://127.0.0.1:5173`.
- Replace raw browser `Failed to fetch` failures with actionable LocalFin-specific API errors.
- Keep the backend API route unchanged: `POST /api/parser/parse-statement`.

## Key Changes
- Configure Vite dev server/proxy so `/api` works consistently from local loopback hosts.
- Keep the Vite `/api` proxy pointed at the Express backend with a deterministic loopback target.
- Improve `src/lib/api.ts` so network failures, non-JSON proxy errors, and backend JSON errors produce clear messages.
- Preserve the existing Add page toast path; it should display the improved API error without Parse Statement-specific handling.

## Test Plan
- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Start with `npm run dev`.
- Verify:
  - `http://localhost:5173/api/health` works.
  - `http://127.0.0.1:5173/api/health` works.
  - Add page Parse Statement succeeds with `05/01/2026 STARBUCKS 4.95`.
  - Backend unavailable state shows the new actionable message instead of raw `Failed to fetch`.

## Assumptions
- This is a local development reliability fix, not a production deployment change.
- No database schema, parser behavior, OpenRouter model config, or API contract should change.
- The preferred supported dev command remains `npm run dev`, which starts both Vite and Express.
