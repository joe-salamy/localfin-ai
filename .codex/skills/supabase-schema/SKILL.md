---
name: supabase-schema
description: Reviews Supabase schema changes (migrations, RLS policies, indexes) against this project's data architecture spec in docs/architecture/data-architecture.md. Validates table definitions, foreign keys, JSONB shapes, RLS policy correctness, and run_state SSOT pattern compliance. Invoke when writing or reviewing SQL migrations, RLS policies, or schema changes.
metadata:
  version: "1.0.0"
  domain: database
  triggers: schema review, migration review, RLS policy, database schema, Supabase migration
  role: specialist
  scope: review
  output-format: report
  related-skills: code-reviewer, api-review, migration-audit
argument-hint: "[migration-file-path]"
---

# Supabase Schema Reviewer

Reviews Supabase/Postgres schema changes against the project's data architecture spec.

## When to Use This Skill

- Writing new SQL migration files
- Reviewing schema changes in PRs
- Adding or modifying RLS policies
- Creating new tables or indexes
- Verifying SSOT pattern compliance for shared data

## Core Workflow

1. **Load Spec** -- Read `docs/architecture/data-architecture.md` for the canonical schema definitions. This is the source of truth.

2. **Load Migration** -- If `$ARGUMENTS` is provided, read that migration file. Otherwise, scan for recent migration files (check `supabase/migrations/` or `backend/supabase/migrations/`).

3. **Validate Against Spec** -- Check each item in `references/schema-checklist.md`.

4. **Report** -- Produce findings categorized as Blocker / Warning / Info.

## Reference Guide

| Topic            | Reference                        | Load When                   |
| ---------------- | -------------------------------- | --------------------------- |
| Schema Checklist | `references/schema-checklist.md` | Always -- primary reference |
| RLS Patterns     | `references/rls-patterns.md`     | Reviewing RLS policies      |

## Constraints

### MUST DO

- Always read `docs/architecture/data-architecture.md` before reviewing
- Verify table names, column types, and constraints match the spec
- Check RLS policies exist for every table with user data
- Verify indexes match the spec
- Check that `run_state` SSOT pattern is followed for shared data
- Verify migration files are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- Check foreign key cascade behavior (ON DELETE CASCADE vs SET NULL)

### MUST NOT DO

- Modify any files (audit only)
- Suggest schema changes that deviate from the architecture spec without flagging it
- Ignore missing RLS policies (security-critical)

## Output Template

```
# Schema Review: {file or description}

## Verdict: Compliant / Non-Compliant / Partially Compliant

## Tables
| Table | Status | Notes |
|---|---|---|
| ... | MATCH / MISMATCH / MISSING | ... |

## RLS Policies
| Table | Policy | Status | Notes |
|---|---|---|---|
| ... | ... | PRESENT / MISSING / INCORRECT | ... |

## Indexes
| Table | Index | Status |
|---|---|---|
| ... | ... | MATCH / MISSING / EXTRA |

## Findings
### Blockers
1. ...

### Warnings
1. ...

### Info
1. ...
```
