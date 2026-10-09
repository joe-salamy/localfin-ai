# Agent Instructions

## Host and file exchange

The live copy of this repo and `data/budget.db` are on inspiron-3535 (daily driver). Spreadsheets and dashboards live beside it in `~/Documents/LocalFin/`:

- `~/Documents/LocalFin/inbox/` — `.fods` exports to edit, edited files to apply, bank CSVs to ingest.
- `~/Documents/LocalFin/reports/` — dashboard and history HTML.

Reports and `*:export` files default to those folders; still pass explicit paths (`--out` for reports, the positional path for `*:export` / `*:apply`). Never leave user-facing files in the repo root. Everything runs locally on the 3535 — no sync step.

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
