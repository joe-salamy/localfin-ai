## Overview

LocalFin AI is a local-first personal finance tracker that uses LLM-powered parsing (OpenRouter/Gemma 3n via `server/ai/`) to let users enter transactions in natural language and automatically extract amounts, dates, categories, and accounts into a SQLite database (`data/budget.db`). The frontend is React 19 + React Router + TanStack Query + Tailwind CSS with Recharts/Nivo for visualizations, served by Vite on port 5173; the backend is Express 5 with better-sqlite3, running on port 3001, with routes split across `server/routes/` and business logic in `server/services/`. The project is TypeScript throughout (compiled with `tsx` for the server), uses `npm run dev` with `concurrently` to start both ends, and requires an `OPENROUTER_API_KEY` in a `.env` file—there is no Python in this repo despite the parent directory name.

## Code Quality

- Run `npm run lint` (or the project's lint script) before committing. Fix all errors; do not disable rules inline without justification.
- Run `npm run typecheck` (or `npx tsc --noEmit`) to verify the project compiles cleanly.
- Prefer early returns over deeply nested conditionals.

## Rules

- Treat `docs/scratchpad.md` as private scratch space. Do not read, search, open, modify, diff, summarize, or quote it. If it appears in broad file listings or git status output, ignore it.
- When plan mode is active, use the `ask` tool every time before producing a plan. Ask any clarifying questions needed, or ask the user to confirm that no clarification is needed.
- Every Markdown plan file must start with a single descriptive H1 (`# ...`) before any `##` sections. Use the H1 as a stable, filesystem-safe worktree-flow title, not a generic label like `Plan`; `worktree-flow.py` derives branch, worktree, staging, and archive names from that header.
- Before performing any edit, briefly state in chat what files or behavior you intend to change and why. Do not wait for approval.
- Be concise by default: answer with only the decision, changed files, verification, and blockers; avoid background, step-by-step narration, repeated summaries, and optional detail unless the user asks for it.
