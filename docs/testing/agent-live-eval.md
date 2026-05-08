# Agent Live Evaluation

The live agent eval sends real prompts to the configured OpenRouter assistant model and checks whether LocalFin AI executed the requested finance actions correctly.

Run it intentionally:

```powershell
$env:RUN_LIVE_AGENT_EVAL='1'
npm run eval:agent:live
```

Required environment:

- `OPENROUTER_API_KEY`
- `RUN_LIVE_AGENT_EVAL=1`

Useful optional environment:

- `AGENT_EVAL_LIMIT=5` runs only the first five scenarios.
- `AGENT_EVAL_KEEP_DBS=1` keeps temporary SQLite databases for inspection.
- `LOCALFIN_DB_PATH` or `LOCALFIN_DATA_DIR` can override database placement, but the runner sets an isolated DB per scenario by default.

Reports are written to `.agent-harness/reports/latest.json` and a timestamped JSON file. Reports include prompts, action types, assertion results, latency, log file paths, and stream event types.

The eval does not run from `npm test`. It is live, networked, model-dependent, and may cost money.
