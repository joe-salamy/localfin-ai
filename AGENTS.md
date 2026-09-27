# Agent Instructions

## Host and file exchange

This repo and `data/budget.db` live on OMEN (headless). The user edits spreadsheets and views dashboards on a laptop, so every user-facing file goes through an exchange folder at the same path on both hosts:

- `~/Documents/LocalFin/inbox/` — `.fods` exports to edit, edited files to apply, bank CSVs to ingest.
- `~/Documents/LocalFin/reports/` — dashboard and history HTML.

Reports and `*:export` files default to those folders; still pass explicit paths (`--out` for reports, the positional path for `*:export` / `*:apply`, e.g. `~/Documents/LocalFin/inbox/categorize-review.fods`). Never leave user-facing files in the repo root. The laptop runs `lfin-sync pull` to fetch outputs and `lfin-sync push [csv...]` to send edits and CSVs (pushed CSVs land in the inbox). After writing a file the user needs, tell them to run `lfin-sync pull`; before applying an edited file, ask them to run `lfin-sync push`. The absolute path you report is the same on the laptop.

## Dashboard generation

For requests to generate the dashboard, use the existing report command; do not rebuild or modify the dashboard implementation unless explicitly asked.

```bash
npm run report:dashboard -- --start YYYY-MM-DD --end YYYY-MM-DD --out ~/Documents/LocalFin/reports/dashboard-<start>-<end>.html
```

- Honor the requested date range. If none is specified, use January 1 of the current year through today's local date (YTD), and state the range used.
- The date range controls only the initial view. Full transaction history is embedded in the HTML and remains available through the page's date controls.
- Use the `--out` path above unless another output path is requested.
- Run the command directly; inspect source, tests, or the database only if needed to troubleshoot generation failures.
- Return the output path and the initial date range, and remind the user to run `lfin-sync pull`.
