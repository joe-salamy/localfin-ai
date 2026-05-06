---
name: cross-stack-types
description: Verifies type consistency between the Python backend (Pydantic models) and TypeScript frontend (generated types). Checks that OpenAPI spec is current, generated TS types match Pydantic models, enums are consistent across languages, and no manual type drift has occurred. Invoke when modifying Pydantic schemas, API response models, or frontend type definitions.
metadata:
  version: "1.0.0"
  domain: quality
  triggers: type consistency, type drift, cross-stack types, OpenAPI types, Pydantic to TypeScript
  role: specialist
  scope: audit
  output-format: report
  related-skills: ts-pro, python-pro, api-review
---

# Cross-Stack Type Consistency Checker

Audits type alignment between Python (Pydantic) backend and TypeScript (generated) frontend.

## When to Use This Skill

- After modifying Pydantic schemas in `src/schemas/`
- After adding or changing FastAPI response models
- After regenerating TypeScript types from OpenAPI
- When frontend displays unexpected data or missing fields
- During PR reviews that touch both backend models and frontend types

## Core Workflow

1. **Identify Pydantic Models** -- Scan `src/schemas/` and any `src/api/models.py` or similar for all Pydantic `BaseModel` classes used as API request/response models.

2. **Check OpenAPI Spec** -- Verify that running the FastAPI app produces an OpenAPI spec (`/openapi.json`) that includes all models from step 1. If a spec file is checked in (e.g., `openapi.json`), compare it against the current Pydantic models for drift.

3. **Check TypeScript Types** -- Find generated type files (likely `frontend/src/types/` or `frontend/types/`). Verify:
   - Types exist for every API response model
   - Field names match (Python snake_case should map to camelCase or match directly)
   - Field types match (see mapping table below)
   - Enums match across languages

4. **Check Manual Types** -- Search for hand-written TypeScript interfaces that duplicate generated types. These are drift risks.

5. **Report** -- Produce findings categorized by severity.

## Type Mapping Reference

| Python (Pydantic) | TypeScript | Notes |
|---|---|---|
| `str` | `string` | |
| `int` | `number` | |
| `float` | `number` | |
| `bool` | `boolean` | |
| `None` | `null` | |
| `str \| None` | `string \| null` | |
| `list[T]` | `T[]` | |
| `dict[str, Any]` | `Record<string, unknown>` | |
| `Literal["a", "b"]` | `"a" \| "b"` | Enum-like |
| `datetime` | `string` | ISO 8601 format |
| `UUID` | `string` | UUID format |
| `Decimal` | `number` or `string` | Check precision needs |
| `BaseModel` (nested) | `interface` | Recursive |

## Enum Consistency Checks

These enums MUST match across Python and TypeScript:

| Enum | Python Location | Values |
|---|---|---|
| `run_phase` | DB enum | `research`, `plan`, `write` |
| `run_status` | DB enum | `pending`, `running`, `paused`, `completed`, `failed`, `cancelled` |
| `step_status` | DB enum | `pending`, `running`, `completed`, `failed`, `skipped` |
| `hitl_action` | DB enum | `approve`, `reject`, `refine`, `skip`, `edit` |
| `notification_type` | DB enum | `step_complete`, `run_complete`, `run_failed`, `hitl_required`, `usage_alert` |

Frontend may also add `waiting_for_approval` as a step status (see migration-roadmap.md Phase 1).

## Type Generation Pipeline

The expected pipeline (from `docs/architecture/tech-stack.md`):

```
Pydantic models -> FastAPI -> OpenAPI spec -> openapi-typescript/orval -> TypeScript types
```

Verify this pipeline is set up and produces current types:

- [ ] `openapi-typescript` or `orval` is in `frontend/package.json` devDependencies
- [ ] A script exists to regenerate types (e.g., `npm run generate-types`)
- [ ] Generated types are NOT manually edited (check for `// @generated` or similar marker)
- [ ] Generated types file is committed (not gitignored)

## Constraints

### MUST DO

- Check both directions: Python model missing from TS types AND TS types not backed by Python model
- Flag any hand-written TypeScript interfaces that duplicate API types
- Verify enum values match exactly (including ordering if relevant to UI)
- Note any fields using `Any` or `unknown` that could be more specific

### MUST NOT DO

- Modify any files (audit only)
- Assume camelCase conversion is automatic (check if middleware exists)
- Ignore `datetime` / `UUID` serialization format differences

## Output Template

```
# Cross-Stack Type Audit

## Type Generation Pipeline
- [ ] openapi-typescript/orval installed: YES/NO
- [ ] Generate script exists: YES/NO
- [ ] Types appear current: YES/NO

## Model Coverage
| Pydantic Model | TS Type Exists | Fields Match | Notes |
|---|---|---|---|
| PipelineRun | Yes/No | Yes/No/Partial | ... |

## Enum Consistency
| Enum | Python Values | TS Values | Match |
|---|---|---|---|
| run_status | [...] | [...] | YES/NO |

## Drift Detected
1. ...

## Recommendations
1. ...
```
