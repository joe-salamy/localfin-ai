# Live Agent Eval Harness

## Summary

Build a live LLM evaluation harness for LocalFin AI's assistant. The harness sends complex human-style prompts to the configured OpenRouter assistant model, lets the application execute the returned actions, then grades pass/fail from the action trace and final SQLite state.

The eval must not use `data/budget.db` by default. Each scenario runs against a temporary isolated SQLite database so the agent can freely create and update accounts, categories, transactions, and goals without touching personal finance data.

## Implementation

- Add an explicit `npm run eval:agent:live` script guarded by `RUN_LIVE_AGENT_EVAL=1` and `OPENROUTER_API_KEY`.
- Add test database path overrides with `LOCALFIN_DB_PATH` / `LOCALFIN_DATA_DIR` and a test-only DB close helper.
- Add a live eval runner under `scripts/` that seeds synthetic finance data, calls the real assistant, captures action results and stream events, snapshots the DB, and writes JSON reports to `.agent-harness/reports/`.
- Grade with a hybrid rubric: exact checks for durable finance outcomes and forbidden writes, tolerance for response wording and harmless action variation.

## Test Coverage

- Onboarding/setup: multiple accounts, categories, subcategories, opening balances, and goals.
- Messy transaction entry: mixed dates, reimbursements, transfers, comments, ambiguous merchants, and corrections.
- Search/filter/update: complex grep-like filters and search-before-update behavior.
- Multi-intent maintenance: account/category/subcategory/goal updates plus new transactions.
- Robustness/refusal: unsupported deletion, invalid dates, duplicates, unknown accounts, and partial failures.
- Streaming: event lifecycle plus final action execution.

## Assumptions

- Live LLM behavior is the target; mocked LLM responses are not the primary test path.
- Automated evals use isolated temp databases; dummy accounts in the real dev database are out of scope for v1.
- The live eval is not part of `npm test` because it requires network, money/time, and model availability.
