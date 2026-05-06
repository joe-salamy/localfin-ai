---
name: tier2-smoke-review
description: Reviews the latest Tier 2 smoke test run (`.\src\scripts\tier2-smoke.ps1`). Reads the testing strategy, the runner script, and every file in the newest `tests/smoke-logs/run-*` folder, then produces a brief failure report with a proposed fix plan. STOPS before fixing — the user flips on auto mode once they've read the report. Invoke after the smoke runner exits non-zero or whenever you want a post-run summary.
metadata:
  version: "1.0.0"
  domain: testing
  triggers: tier2 smoke, smoke review, tier 2 review, smoke log review, smoke test results
  role: specialist
  scope: diagnose
  output-format: report
  related-skills: api-review, sse-audit, docker-review
argument-hint: "[optional-path-to-run-folder]"
---

# Tier 2 Smoke Review

Diagnoses a Tier 2 smoke run (`.\src\scripts\tier2-smoke.ps1`) by reading its log bundle + the strategy + the runner script, then reports failures and a fix plan. Does **not** edit any files — the user reviews the report, then enables auto mode to apply fixes.

## When to Use This Skill

- Immediately after `.\src\scripts\tier2-smoke.ps1` exits (success or failure)
- When investigating an old smoke run that needs a second look
- Before re-running the smoke test — confirm the last failure is understood first

## Core Workflow

1. **Locate the run folder.**
   - If `$ARGUMENTS` is a path, use it.
   - Otherwise pick the newest directory under `tests/smoke-logs/` (lexicographic sort on `run-YYYYMMDD-HHMMSS` — newest wins).
   - Echo the chosen folder in the first line of the report so the user can confirm.

2. **Read the three sources in parallel.** All three are required — do not skip any.
   - `docs/testing/testing-strategy.md` — authoritative description of what Tier 2 should do and what each block validates. Use it as the spec.
   - `src/scripts/tier2-smoke.ps1` — the runner. Use it to map observed log lines back to the exact block / command that produced them.
   - Every file in the chosen run folder:
     - `summary.log` — high-level timeline (read first, it tells you where the run died)
     - `api.log` / `api.err.log` — uvicorn stdout/stderr (note: uvicorn writes to stderr by default, so `api.log` is usually empty — that's normal, not a bug)
     - `worker.log` / `worker.err.log` — arq stdout/stderr (same stderr-default caveat)
     - `sse.log` — SSE event stream (only present if the run got past run creation)
     - `upload-response.json` — POST inputs response (only on non-`-ReuseProjectId` runs)
     - `final-run.json` — terminal `GET /api/runs/{id}` payload (only if the run reached a terminal status)

3. **Build a timeline.** Merge `summary.log` timestamps with the relative order of API/worker log lines. Identify the **first** failure — downstream errors are usually cascades.

4. **Classify the failure domain.** Every Tier 2 failure falls into exactly one of these buckets. State which one in the report:
   - **Infra / connectivity** — API never healthy, Redis connection refused, Supabase 5xx, JWT fetch failed.
   - **Runner script bug** — PowerShell syntax, wrong URL/host, bad variable substitution, timeout too short, process-lifetime mishandled.
   - **API server bug** — startup exception, missing env var, import error, route 5xx.
   - **Worker bug** — arq task crash, pipeline step exception, HITL block that shouldn't exist in `interactive=false`, storage write failure.
   - **LLM / provider** — auth error, model not found, rate limit, structured-output validation failure.
   - **Test data** — input files missing/malformed, project_inputs upload rejected.

5. **Produce the report.** Use the Output Template below. Keep it brief — bullets over prose. Cite specific file names and line numbers from the log bundle.

6. **STOP.** Do not edit files. Do not run fixes. End the response with the literal line:

   > Ready for fix. Flip on auto mode and say "go" to apply the plan above.

## Constraints

### MUST DO

- Read all three sources (strategy doc, runner script, every file in the run folder) before writing anything.
- Cite log file names and line numbers as evidence for every claimed failure.
- Distinguish first-cause failures from cascade failures. Cascades go in a separate "Cascade effects" section, not in the primary diagnosis.
- Cross-check observed behaviour against `docs/testing/testing-strategy.md` § "What the non-interactive smoke test validates" — if a validation point was skipped, say so.
- Note when `api.log` / `worker.log` (stdout) are empty — that is **expected** on Windows because uvicorn and arq log to stderr. Don't flag it as a bug.

### MUST NOT DO

- Edit any file, including the runner script, the app code, or logs.
- Run the smoke test again from this skill.
- Recommend fixes that haven't been validated against the strategy doc (e.g. don't suggest changes that contradict the "What Tier 2 validates" list).
- Skip the runner-script read — many failures are client-side PowerShell bugs that only make sense once you've seen the exact command.
- Write more than ~40 lines of report. Brief is the whole point.

## Output Template

```
# Tier 2 Smoke Review: {run folder}

## Verdict
{PASS | FAIL at block N ({block name})}

## Timeline
- HH:MM:SS — {event} ({source: summary.log / api.err.log:line / ...})
- HH:MM:SS — {event} (...)
- HH:MM:SS — {first failure} (...)

## Failure Domain
{one of: infra | runner script | API | worker | LLM | test data}

## Root Cause (first failure only)
{1-3 sentences. Cite the exact log line.}

## Cascade Effects (if any)
- {downstream error X, caused by root cause above}

## Validation Coverage (per strategy doc §2 "What the non-interactive smoke test validates")
- [x] API server starts without import errors
- [x] Auth middleware accepts good tokens
- [ ] Worker picks up job — not reached
- [ ] ... etc.

## Fix Plan
1. **{file:line}** — {one-line change}
2. ...

## Re-run command
{exact command — usually `.\src\scripts\tier2-smoke.ps1` or `.\src\scripts\tier2-smoke.ps1 -ReuseProjectId <uuid>`}

Ready for fix. Flip on auto mode and say "go" to apply the plan above.
```
