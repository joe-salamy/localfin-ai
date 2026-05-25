# Agent System Lab Skill

## Summary

Create a repo-local Codex skill at `.codex/skills/agent-system-lab` that captures a repo-agnostic methodology for building effective agentic systems. The skill guides Codex to discover real user tasks, create live LLM-call evals that simulate human behavior, verify observability/logging, and iteratively improve the agent across prompts, tools, knowledge sources, and context efficiency.

## Implementation Steps

1. Create feature branch `skill/agent-system-lab` from `main`.
2. Write this implementation plan to `docs/plans/agent-system-lab.md`.
3. Initialize the skill at `.codex/skills/agent-system-lab` with `references/` and `agents/openai.yaml`.
4. Write `SKILL.md` as a concise workflow:
   - Trigger when designing, evaluating, improving, hardening, or iterating on an agentic system.
   - State that the skill is a personal methodology usable in any repo.
   - Start with a repo-wide use-case analysis document, defaulting to `docs/agent-use-cases.md`.
   - Split use cases into clean categories by user intent and workflow type.
   - Require each use case to include realistic user prompts, expected outcomes, tools/knowledge likely needed, state changes, failure modes, and acceptance criteria.
   - Verify agent logging before or alongside eval harness work.
   - Build live LLM-call evals after the use-case document exists, before improving the agent.
   - Emphasize black-box, real-human-behavior evals: prompts should describe user goals, not tool calls.
   - Include simple, medium, and highly complex tasks requiring multi-step reasoning, multiple tools, knowledge sources, clarifications, and final synthesis.
   - Iterate: run live evals, inspect failures, improve prompts/tools/knowledge/context/data flow, prune ineffective tools or instructions, rerun, and stop only on pass or bounded-loop exhaustion.
5. Add `references/eval-methodology.md` with deeper guidance on live calls, realistic user-task prompts, hybrid grading, eval integrity, and the test/improvement loop.
6. Add `references/agent-logging.md` with default two-layer logging guidance:
   - Full trace log for all agent-related LLM calls.
   - Compact structured summary log for tool calls, knowledge calls, state reads/writes, retries, failures, and final outcomes.
   - Respect existing logging when effective.
7. Generate or update `agents/openai.yaml`.
8. Validate the skill with `quick_validate.py`.
9. Verify the skill remains repo-agnostic and contains no project-specific examples.

## Test Plan

- Run the skill validation script against `.codex/skills/agent-system-lab`.
- Search the new skill folder for project-specific terms.
- Inspect the methodology sequence:
  1. use-case analysis document,
  2. logging/tracing verification,
  3. live real-user-task eval creation,
  4. eval-first execution,
  5. agent improvement across prompts/tools/knowledge/context,
  6. pruning and efficiency review,
  7. bounded iteration until pass or documented residual failures.
- Optionally forward-test the skill in a fresh context by asking another agent to use it on a generic agent repo task and checking whether it produces realistic human-task evals, not tool-specific tests.

## Assumptions

- Install location is repo-local: `.codex/skills/agent-system-lab`.
- The skill is repo-agnostic.
- Default use-case analysis output path is `docs/agent-use-cases.md`.
- Default live-eval loop is bounded with explicit max iterations, calls, time, or cost.
- The skill recommends default logging only when the repo lacks adequate logging; existing solid logging should be preserved and extended only where needed.
