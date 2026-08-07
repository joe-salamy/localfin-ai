Implemented and committed the approved architecture simplification.

- Commit: `2d1dcb2` — `Simplify LocalFin architecture`
- Added shared Zod/domain contracts, strict finance tool definitions, typed executor boundaries, structured categorization, metadata-only AI logs, reduced SSE events, reducer-based chat state, shared spreadsheet selection helpers, agent evaluation primitives, and centralized entity-name validation.
- Removed obsolete raw OpenRouter streaming/client code and duplicated validators.
- Preserved finance mutations, persistence, action ordering, partial failures, table behavior, and both chat routes.
- Handoff: `.omp/handoff/implementation-summary.md`

Verification passed:

- `npm run typecheck`
- `npm run lint`
- `npm run test:server` — 71 passed
- `npm run test:scripts` — 7 passed
- Frontend suite with bounded workers — 25 files, 106 passed
- `npm run build`
- `git diff --check`

Skipped:

- Browser/live-model smoke: no safe disposable database or credentialed live setup available.
- Planned documentation updates: the named `docs/` files do not exist in this checkout, so no new documentation was fabricated.

Only workflow artifacts remain untracked under `.omp/`.
