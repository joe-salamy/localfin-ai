# Agent Instructions

## Host and file exchange

The live copy of this repo and `data/budget.db` are on inspiron-3535 (daily driver). User-facing files are exchanged directly through `~/Downloads` — there is no separate inbox or reports folder:

- Bank CSV statements the user downloads are read from `~/Downloads/`.
- Reports (`report:dashboard`, `report:history`) and review sheets (`categorize:export`, `taxonomy:export`, `categorize:apply-judgments`) default to `~/Downloads/`.
- The `localfin-ai` agent-jail project grant gives agents launched in this repo read-write access to `~/Downloads` on the 3535.

Reports and `*:export` files default to that folder; still pass explicit paths (`--out` for reports, the positional path for `*:export` / `*:apply`). Never leave user-facing files in the repo root. Everything runs locally on the 3535 — no sync step.

## New bank transactions

When the user asks to add/ingest new transactions or categorize a new statement without giving a path, look in `~/Downloads/` for bank CSVs.

Flow: `npm run ingest:downloads -- --dry-run`, then `npm run ingest:downloads`. It maps each CSV in `~/Downloads` to an account through `scripts/statement-accounts.json` (file-name regex → account name). Files with no matching rule are skipped and listed (use `npm run ingest:csv -- --file ~/Downloads/<file>.csv --account "<name>"` for those); a file matching two-plus rules, or a mapped file with an unknown format, aborts before any write. Successful ingest move-archives each source CSV into `data/archive/statements/` (re-runs are safe: duplicates are skipped) and prints per-file counts, including how many rows still need a category. Then categorize per `skill://localfin-categorization` (`categorize:prepare` → Python `judge_batch` → `categorize:apply-judgments`); its review sheet goes to `~/Downloads/categorize-review.fods`.

An OMEN checkout exists for development only. Its `.env` points at `data/testing/dev-scratch.db`; never run ingest/categorize/apply there against live data.

## Dashboard generation

For requests to generate the dashboard, use the existing report command; do not rebuild or modify the dashboard implementation unless explicitly asked.

```bash
npm run report:dashboard -- --start YYYY-MM-DD --end YYYY-MM-DD --out ~/Downloads/dashboard-<start>-<end>.html
```

- Honor the requested date range. If none is specified, use January 1 of the current year through today's local date (YTD), and state the range used.
- The date range controls only the initial view. Full transaction history is embedded in the HTML and remains available through the page's date controls.
- Use the `--out` path above unless another output path is requested.
- Run the command directly; inspect source, tests, or the database only if needed to troubleshoot generation failures.
- Return the output path and the initial date range.
