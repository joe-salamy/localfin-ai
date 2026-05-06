# Migration Audit Report Template

## Format

```markdown
# Migration Audit: Phase {N} — {Phase Name}

**Date:** {date}
**Audited by:** /migration-audit

## Verdict: {Ready | Not Ready | Partially Ready}

{One-sentence summary of overall state.}

---

## Prerequisites

| Prerequisite Phase | Status | Notes |
|---|---|---|
| Phase {N-1}: {name} | PASS / FAIL | {details} |

---

## Deliverables

| # | Deliverable | Status | Evidence | Notes |
|---|---|---|---|---|
| 1 | {deliverable name} | PASS / FAIL / PARTIAL | `{file:line}` | {details} |

---

## Blockers

Issues that MUST be resolved before this phase is considered complete.

1. **{Title}** — {description}. Found in `{file:line}`.
   - **Impact:** {what breaks if not fixed}
   - **Suggested fix:** {concrete action}

---

## Warnings

Issues that SHOULD be resolved but do not block phase completion.

1. **{Title}** — {description}.

---

## Info

Observations worth noting but not actionable.

1. {observation}

---

## Next Steps

If verdict is Ready:
- [ ] Phase {N+1} can begin: {phase name}
- [ ] {any prep work for next phase}

If verdict is Not Ready:
- [ ] Fix blockers listed above
- [ ] Re-run `/migration-audit {N}` to verify
```

## Verdict Criteria

- **Ready**: All deliverables PASS, no blockers, prerequisites met.
- **Partially Ready**: Most deliverables PASS, remaining items are non-blocking or have known workarounds.
- **Not Ready**: One or more blockers exist, or prerequisite phases are incomplete.
