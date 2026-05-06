---
name: audit-ts
description: Audits the Next.js frontend for TypeScript type errors (tsc --noEmit) and ESLint issues, produces a structured fix plan, waits for user approval, then applies fixes and re-verifies. Frontend-only. Invoke after writing/editing TS/TSX code or before opening a PR.
metadata:
  version: "1.0.0"
  domain: quality
  triggers: typescript audit, ts audit, type check, typecheck, tsc errors, eslint errors, lint errors, audit ts, audit frontend types
  role: specialist
  scope: audit-and-fix
  output-format: report
  related-skills: ts-pro, code-reviewer, cross-stack-types, react-best-practices
argument-hint: "[optional-subpath-within-frontend]"
---

# Audit TypeScript

Runs `tsc --noEmit` and `eslint` across the `frontend/` workspace, groups the results into a fix plan, and waits for explicit user approval before editing any files. Frontend-only — never audits Python or root-level TS.

## When to Use This Skill

- After writing or editing any `.ts` / `.tsx` in `frontend/`
- Before opening a PR that touches the frontend
- When the user reports "weird type errors" or VS Code red squiggles they don't trust
- Before running `cross-stack-types` (audit-ts catches issues that would confuse that skill)

## Core Workflow

This skill has **three phases**. **Phase 2 is a hard stop** — never proceed to Phase 3 without explicit user approval.

### Phase 1 — Collect

1. Run `npm run typecheck` from `frontend/`. Capture stdout, stderr, and exit code.
   - Fallback if script missing for some reason: `npx tsc --noEmit`
2. Run `npm run lint` from `frontend/`. Capture output and exit code.
3. If both exit 0 with no output, report "clean" and stop. Do not proceed to Phase 2.
4. If an optional subpath argument was provided (e.g., `src/components/foo`), still run the full-project tsc (type errors are whole-project by nature) but filter the *reported* issues to that path. Run ESLint scoped to that path.

### Phase 2 — Fix Plan (STOP AFTER THIS)

1. Parse tsc output into `{file, line, col, code, message}` entries.
2. Parse ESLint output into `{file, line, col, rule, severity, message}` entries.
3. For each entry, read the relevant file/region so the proposed fix is grounded in the actual code — not guessed from the error message.
4. Classify each issue:
   - **Type error** (from tsc) — usually requires a real code change
   - **Lint error** (ESLint `error` severity)
   - **Lint warning** (ESLint `warn` severity)
5. For each issue, draft a **specific** proposed fix — show the exact edit, not a vague intent. If an issue is a symptom of a deeper bug (e.g., a prop is typed `string | undefined` and the callsite ignores `undefined`), flag it as "needs design decision" and propose options instead of a single fix.
6. Group fixes by file for review clarity.
7. Produce the Fix Plan report using the Output Template below.
8. **STOP.** End your message with: `Reply "approve" to apply these fixes, or tell me which to change/skip.` Do not make edits.

### Phase 3 — Apply & Verify (only after user approves)

1. Apply fixes via the `Edit` tool, one file at a time.
2. If the user said "approve except X, Y" or similar, skip those items.
3. After all edits, re-run `npm run typecheck` and `npm run lint`.
4. Produce a Verification report showing:
   - Fixes applied
   - Fixes skipped (and why, if user specified)
   - Remaining issues (with the same structure as Phase 2 — the user can re-invoke the skill on the remainder)
   - Any **new** issues introduced by the fixes (flag prominently — usually means a fix was wrong)

## Constraints

### MUST DO

- Run from the `frontend/` directory — never from repo root
- Read each file before proposing a fix for it
- Show the exact proposed edit (old code → new code) in the plan, not a description
- Stop and wait for approval after Phase 2
- Re-run both checks after applying fixes in Phase 3
- Preserve existing code style (imports, quote style, trailing commas) — don't let a fix cause a formatting churn

### MUST NOT DO

- Do **not** run `eslint --fix` or any auto-fixer without surfacing the changes first
- Do **not** introduce `any`, `as any`, `// @ts-ignore`, or `// @ts-expect-error` to silence type errors unless the user explicitly approves it for a specific case
- Do **not** modify `tsconfig.json` or `eslint.config.*` to silence rules. If a rule is genuinely wrong for the project, flag it in the plan and let the user decide — don't relax config to make errors go away
- Do **not** audit anything outside `frontend/`
- Do **not** "fix" generated files (`src/lib/api-types.ts` is generated from the backend OpenAPI spec — flag upstream drift instead of editing it)
- Do **not** proceed to Phase 3 without explicit approval in the user's next message
- Do **not** batch-edit multiple files in parallel when applying fixes — sequential edits make verification sane if something goes wrong

## Output Template — Phase 2 Fix Plan

```
# TypeScript Audit — Fix Plan

## Summary
- Type errors (tsc):   X
- Lint errors:         Y
- Lint warnings:       Z
- Files affected:      N

## Type Errors

### `src/path/to/file.tsx`

**1. Line 42, col 10 — TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.**

Current:
```tsx
handleFoo(user.name)
```

Proposed fix:
```tsx
if (user.name) handleFoo(user.name)
```

Rationale: `user.name` is optional per the `User` type; narrow before passing.

---

## Lint Errors

### `src/path/to/other.tsx`

**1. Line 18 — `react-hooks/exhaustive-deps`: React Hook useEffect has a missing dependency: 'fetchData'.**

Current:
```tsx
useEffect(() => { fetchData(id) }, [id])
```

Proposed fix:
```tsx
useEffect(() => { fetchData(id) }, [id, fetchData])
```

(or: wrap `fetchData` in `useCallback` at its definition — flag for design decision if `fetchData` is defined in a parent)

---

## Needs Design Decision

**1. `src/components/Form.tsx:55` — TS2322**

The prop `onSubmit` is typed `(v: FormValues) => void` but the handler returns `Promise<void>`. Options:
- (a) Change the prop type to `(v: FormValues) => void | Promise<void>`
- (b) Wrap the handler to not return the promise: `onSubmit={(v) => { void handle(v) }}`

Recommendation: (a) — other callsites likely also pass async handlers.

---

Reply "approve" to apply these fixes, or tell me which to change/skip.
```

## Output Template — Phase 3 Verification

```
# TypeScript Audit — Verification

## Applied
- `src/foo.tsx:42` — narrowed `user.name` before use
- `src/bar.tsx:18` — added `fetchData` to deps array
- ... (N total)

## Skipped (per user request)
- `src/baz.tsx:55` — deferred for design decision

## Re-check Results
- `npm run typecheck`: X errors (was Y)
- `npm run lint`:      X errors, Y warnings (was Z errors, W warnings)

## Remaining Issues
{table of remaining issues, same structure as Phase 2}

## New Issues Introduced
{flag prominently if any — usually indicates a bad fix}

{If clean: "All audited issues resolved. No new issues."}
```

## Notes

- `tsc --noEmit` and the tsconfig's `.next/types/**/*.ts` glob: if `.next/` hasn't been generated yet, the glob matches nothing and tsc proceeds. No need to run `next dev` first.
- If `npm run typecheck` fails with "command not found," the script may not be in `package.json` yet — add it (`"typecheck": "tsc --noEmit"`) and retry. Flag this to the user.
- `src/lib/api-types.ts` is generated. If type errors point there, the real fix is regenerating via `npm run generate-types` (requires the API server running) — say so, don't edit the file.
