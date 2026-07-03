Resolved the merge conflict. No commit made.

Changed:
- `src/components/features/TagManager.tsx`
  - Kept latest `main` Tags UI shape: `Tag`, `Color`, `Actions`.
  - Kept feature double-click edit behavior for tag/name and color cells.
  - Removed feature-side tag type UI from the merge result because latest `main` removed tag type from the UI.
  - Kept actions cell click-only.
- `.omp/handoff/conflict-resolution-summary.md`
  - Written with conflicted file, resolution decisions, preserved base/feature behavior, checks, skipped checks, and residual risk.

Conflict state:
- `git diff --name-only --diff-filter=U` â†’ no output.
- Conflict marker scan over affected files â†’ no markers found.
- `src/components/features/TagManager.tsx` staged as resolved.
- Worktree still has workflow artifacts untracked, as expected:
  - `.omp/handoff/`
  - `.omp/worktree-flow/20260702-175559-double-click-field-editing/`

Verification:
- `git diff --check` â€” passed.
- `git diff --cached --check` â€” passed.
- `node --import tsx --test src/lib/fieldEditDoubleClick.test.ts` â€” passed, 4/4.
- `npm run test:frontend` â€” passed, 46/46.
- `npm run typecheck` â€” passed.
- `npm run lint` â€” passed.

Note:
- Initial checks failed because the integration worktree had no local dependencies installed (`tsx`, `tsc`, `eslint` unavailable). Ran `npm install`, then reran all checks successfully.
