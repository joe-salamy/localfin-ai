# Agent Instructions

## Host and file exchange

The live copy of this repo and `data/budget.db` are on inspiron-3535 (daily driver). Spreadsheets and dashboards live beside it in `~/Documents/LocalFin/`:

- `~/Documents/LocalFin/inbox/` — `.fods` exports to edit, edited files to apply, bank CSVs to ingest.
- `~/Documents/LocalFin/reports/` — dashboard and history HTML.

Reports and `*:export` files default to those folders; still pass explicit paths (`--out` for reports, the positional path for `*:export` / `*:apply`). Never leave user-facing files in the repo root. Everything runs locally on the 3535 — no sync step.

## New bank transactions

When the user asks to add/ingest new transactions or categorize a new statement without giving a path, look in `~/Inbox/` for staged bank CSVs. They run `csvinbox` (fish function) to move `~/Downloads/*.csv` there; `~/Downloads` is hidden inside the agent jail, so never look there. If no CSV is staged, say so and ask them to run `csvinbox` instead of guessing.

Flow: `npm run ingest:inbox -- --dry-run`, then `npm run ingest:inbox`. It maps each staged CSV to an account through `scripts/inbox-accounts.json` (file-name regex → account name) and aborts before any write when a file matches zero or two-plus rules or has an unknown format; for an unmapped file ask which account it belongs to, then add a rule (or use `npm run ingest:csv -- --file ~/Inbox/<file>.csv --account "<name>"` once). Successful ingest move-archives each source CSV into `data/archive/statements/` (re-runs are safe: duplicates are skipped) and prints per-file counts, including how many rows still need a category. Then categorize per `skill://localfin-categorization` (`categorize:prepare` → Python `judge_batch` → `categorize:apply-judgments`); its review sheet goes to `~/Documents/LocalFin/inbox/`, never `~/Inbox/`.

An OMEN checkout exists for development only. Its `.env` points at `data/testing/dev-scratch.db`; never run ingest/categorize/apply there against live data.

## Dashboard generation

For requests to generate the dashboard, use the existing report command; do not rebuild or modify the dashboard implementation unless explicitly asked.

```bash
npm run report:dashboard -- --start YYYY-MM-DD --end YYYY-MM-DD --out ~/Documents/LocalFin/reports/dashboard-<start>-<end>.html
```

- Honor the requested date range. If none is specified, use January 1 of the current year through today's local date (YTD), and state the range used.
- The date range controls only the initial view. Full transaction history is embedded in the HTML and remains available through the page's date controls.
- Use the `--out` path above unless another output path is requested.
- Run the command directly; inspect source, tests, or the database only if needed to troubleshoot generation failures.
- Return the output path and the initial date range.
