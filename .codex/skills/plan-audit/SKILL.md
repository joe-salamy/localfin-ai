---
name: plan-audit
description: Audits git diff of current branch vs main against a Claude Code plan file to find unfinished work, then recommends which project skills to run against the implemented code. Invoke with path to the plan markdown file.
metadata:
  version: "1.0.0"
  domain: quality
  triggers: plan audit, plan check, plan vs diff, implementation audit, plan completion
  role: specialist
  scope: audit
  output-format: report
  related-skills: code-reviewer, migration-audit, differential-review
argument-hint: "[path-to-plan-file]"
---

# Plan Audit

Compares a Claude Code plan against the actual branch diff to surface unfinished work, then recommends follow-up skills.

## When to Use This Skill

- After implementing a plan and before opening a PR
- Mid-implementation to check progress against the plan
- When picking up someone else's in-progress branch

## Core Workflow

1. **Load Plan** -- Read the plan file at `$ARGUMENTS`. If no path provided, ask the user. Parse every task / step / deliverable into a checklist. Preserve the plan's own hierarchy (phases, steps, sub-items). Ignore any "context" or "background" sections -- focus on actionable items.

2. **Collect Diff** -- Run `git diff main...HEAD --stat` and `git diff main...HEAD` to get the full branch diff against main. Also run `git log main..HEAD --oneline` to see commit history.

3. **Map Plan → Diff** -- For each plan item, determine its status:
   - **Done** -- The diff clearly implements this item (cite files/hunks).
   - **Partial** -- Some but not all of the work is present (explain what's missing).
   - **Not Started** -- No evidence in the diff.
   - **Skipped (intentional)** -- The diff shows an alternative approach or the item was superseded. Note this but don't flag as unfinished.

4. **Verify Wiring** -- For items marked Done, spot-check that the code is actually wired up, not just created. A new file that nothing imports doesn't count as Done.

5. **Report** -- Produce the audit report using the Output Template below.

6. **Recommend Skills** -- Scan `.claude/skills/` for all available SKILL.md files. Read each skill's `description` and `triggers` fields. Recommend skills whose domain matches the types of changes in the diff (e.g., FastAPI changes → `api-review`, React changes → `react-best-practices`, DB migrations → `supabase-schema`). Rank by relevance, max 5.

## Constraints

### MUST DO

- Read the full plan file before checking anything
- Use the actual git diff, not just file existence
- Cite specific files and line ranges as evidence
- Distinguish partial from not-started clearly
- Read skill descriptions from disk, don't guess from names

### MUST NOT DO

- Modify any files (audit only)
- Implement missing items (just report them)
- Recommend more than 5 skills
- Skip the wiring check -- a file that exists but isn't imported/used is Partial, not Done

## Output Template

```
# Plan Audit: {plan file name}

## Branch: {branch name} ({N} commits ahead of main)

## Completion Summary
- Done: X / Y items
- Partial: X / Y items
- Not Started: X / Y items
- Skipped: X / Y items

## Detailed Status

### {Plan Section / Phase}

| # | Plan Item | Status | Evidence | Notes |
|---|-----------|--------|----------|-------|
| 1 | ... | Done | `src/foo.py:12-45` | ... |
| 2 | ... | Partial | `src/bar.py` created but not imported | Missing: ... |
| 3 | ... | Not Started | -- | ... |

### {Next Plan Section / Phase}
...

## Unfinished Items (action required)

1. **{item}** -- {what's missing, how to finish}
2. ...

## Recommended Skills

Run these skills against the branch to audit code quality:

| Skill | Why | Invoke |
|-------|-----|--------|
| `api-review` | Branch adds FastAPI endpoints | `/api-review` |
| ... | ... | ... |
```
