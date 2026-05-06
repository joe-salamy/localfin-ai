---
name: migration-simplify
description: Tracks and audits the two pending pipeline simplification items from the architecture review — Item #2 (flatten mixin hierarchy to standalone functions with explicit StepDeps/PlanStepState) and Item #7 (replace ChainGenerator LCEL abstraction with thin StructuredLLMInvoker). Checks current progress, verifies no regressions, and validates the metadata contract. Invoke when working on pipeline refactoring.
metadata:
  version: "1.0.0"
  domain: quality
  triggers: simplify pipeline, flatten mixins, chain generator, pipeline refactoring, StepDeps, PlanStepState, StructuredLLMInvoker
  role: specialist
  scope: audit
  output-format: report
  related-skills: code-reviewer, python-pro, migration-audit
---

# Pipeline Simplification Tracker

Audits progress on the two approved simplification items from `docs/architecture/pipeline-vs-agent-architecture.md` Part 7.

## When to Use This Skill

- Before or after working on pipeline refactoring
- When modifying step functions, mixins, or the chain generator
- To verify the metadata contract hasn't regressed
- When planning the next simplification increment

## Background

Two simplifications were approved after the architecture audit:

**Item #2 -- Flatten Service/Mixin Hierarchy**

- Current: Steps split across `Steps24Mixin`, `Steps57Mixin`, `Steps811Mixin` with hidden state on `self`
- Target: Standalone step functions with explicit `StepDeps` + `PlanStepState` containers
- Risk: Refinement post-processing breaks when mapping state isn't prepared

**Item #7 -- Simplify Chain Generator**

- Current: `ChainGenerator` with LCEL `RunnableLambda` composition
- Target: Thin `StructuredLLMInvoker` with `invoke_structured()` / `batch_structured()`
- Risk: Silent regression in metadata shape breaks refinement (`_metadata.input_messages` missing)

## Core Workflow

1. **Load Spec** -- Read `docs/architecture/pipeline-vs-agent-architecture.md` Part 7 for the target architecture.

2. **Audit Item #2** -- Check mixin status across all phases. Load `references/item2-checklist.md`.

3. **Audit Item #7** -- Check chain generator status. Load `references/item7-checklist.md`.

4. **Verify Metadata Contract** -- The refinement flow depends on specific metadata fields. Verify they are preserved regardless of which invoker is used.

5. **Report** -- Produce progress report with next steps.

## Reference Guide

| Topic           | Reference                       | Load When                |
| --------------- | ------------------------------- | ------------------------ |
| Item #2 Details | `references/item2-checklist.md` | Auditing mixin flatten   |
| Item #7 Details | `references/item7-checklist.md` | Auditing chain generator |

## Constraints

### MUST DO

- Read the architecture spec before auditing
- Check that `_metadata.input_messages` is preserved in any new invoker
- Verify tests exist for the metadata contract before declaring Item #7 safe
- Track which step functions have been migrated and which haven't

### MUST NOT DO

- Modify any files (audit only)
- Recommend changes that break the refinement flow
- Skip the metadata contract check

## Output Template

```
# Pipeline Simplification Progress

## Item #2: Flatten Mixin Hierarchy

### Plan Phase
| Mixin | Steps | Status | Notes |
|---|---|---|---|
| Steps24Mixin | 2, 3, 4 | MIGRATED / IN PROGRESS / NOT STARTED | ... |
| Steps57Mixin | 5, 6, 7 | ... | ... |
| Steps811Mixin | 8, 9, 10, 11 | ... | ... |

### Write Phase
| Mixin | Steps | Status | Notes |
|---|---|---|---|
| Steps12Mixin | 1, 2 | ... | ... |
| Steps34Mixin | 3, 4 | ... | ... |
| Steps510Mixin | 5-10 | ... | ... |
| ReviseMixin | revision | ... | ... |

### Research Phase
| Mixin | Steps | Status | Notes |
|---|---|---|---|
| Steps16Mixin | 1-6 | ... | ... |

### Explicit State Containers
- [ ] `StepDeps` dataclass exists
- [ ] `PlanStepState` dataclass exists
- [ ] Step functions use explicit signatures (not `self` state)

## Item #7: Simplify Chain Generator

### Status
- [ ] Contract tests for `_metadata.input_messages` exist
- [ ] Contract tests for token fields exist
- [ ] Contract tests for timestamps exist
- [ ] `StructuredLLMInvoker` (or equivalent) exists
- [ ] `invoke_structured()` function exists
- [ ] `batch_structured()` function exists
- [ ] `ChainGenerator` removed or deprecated
- [ ] All step functions use the new invoker

### Metadata Contract
| Field | Preserved | Tested |
|---|---|---|
| `_metadata.input_messages` | YES/NO | YES/NO |
| `_metadata.tokens` | YES/NO | YES/NO |
| `_metadata.response_time_minutes` | YES/NO | YES/NO |
| `_metadata.llm_response` | YES/NO | YES/NO |

## Recommended Next Step
{Based on current progress, what should be done next per the implementation order in §7.4}
```
