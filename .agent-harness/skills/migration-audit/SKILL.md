---
name: migration-audit
description: Validates that a specific migration phase is complete by checking deliverables against actual code state. Reads the migration roadmap, scans for expected files/protocols/endpoints, and produces a structured readiness report. Use before starting the next migration phase. Invoke with phase number (0-5).
metadata:
  version: "1.0.0"
  domain: quality
  triggers: migration audit, phase check, migration readiness, phase complete
  role: specialist
  scope: audit
  output-format: report
  related-skills: code-reviewer, supabase-schema, api-review
argument-hint: "[phase-number: 0-5]"
---

# Migration Audit

Validates migration phase completion against the roadmap spec before starting the next phase.

## When to Use This Skill

- Before starting a new migration phase
- After completing a significant chunk of migration work
- When unsure if a phase is truly done
- During code review of migration PRs

## Core Workflow

1. **Load Spec** -- Read `docs/architecture/migration-roadmap.md` and identify the deliverables for the target phase (`$ARGUMENTS`). If no phase number is provided, ask which phase to audit.

2. **Scan Codebase** -- For each deliverable, verify it exists in the actual code. Use file existence checks, grep for protocol implementations, check test coverage. Load `references/phase-checklists.md` for detailed checks per phase.

3. **Cross-Reference Architecture Docs** -- For phases that introduce new infrastructure (DB schema, API endpoints, frontend pages), cross-reference against the relevant architecture docs:
   - Phase 1: `docs/architecture/data-architecture.md`, `docs/architecture/tech-stack.md`
   - Phase 2: `docs/architecture/tech-stack.md` (frontend sections)
   - Phase 3: `docs/architecture/data-architecture.md` (branching model)
   - Phase 4: `docs/agent/AGENT_DESIGN_SPEC.md`

4. **Check Dependencies** -- Verify that prerequisite phases are complete per the dependency map in migration-roadmap.md.

5. **Report** -- Produce a structured readiness report using `references/report-template.md`.

## Reference Guide

| Topic            | Reference                        | Load When                   |
| ---------------- | -------------------------------- | --------------------------- |
| Phase Checklists | `references/phase-checklists.md` | Always -- primary reference |
| Report Template  | `references/report-template.md`  | Writing the final report    |

## Constraints

### MUST DO

- Read the migration roadmap before checking anything
- Verify prerequisite phases are complete
- Check for both file existence AND correct wiring (a protocol that exists but isn't used doesn't count)
- Report items as Blocker / Warning / Info
- Include specific file paths and line numbers in findings

### MUST NOT DO

- Modify any files (audit only)
- Skip prerequisite phase checks
- Mark a phase as "ready" if any blockers exist
- Check phases beyond what was requested

## Output Template

```
# Migration Audit: Phase $ARGUMENTS

## Verdict: Ready / Not Ready / Partially Ready

## Prerequisites
- Phase X: [PASS/FAIL] -- [details]

## Deliverables
| Deliverable | Status | Evidence | Notes |
|---|---|---|---|
| ... | PASS/FAIL/PARTIAL | file:line | ... |

## Blockers (must fix)
1. ...

## Warnings (should fix)
1. ...

## Info
1. ...
```
