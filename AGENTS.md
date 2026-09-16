# Agent Instructions

## Dashboard generation

For requests to generate the dashboard, use the existing report command; do not rebuild or modify the dashboard implementation unless explicitly asked.

```bash
npm run report:dashboard -- --start YYYY-MM-DD --end YYYY-MM-DD
```

- Honor the requested date range. If none is specified, use January 1 of the current year through today's local date (YTD), and state the range used.
- The date range controls only the initial view. Full transaction history is embedded in the HTML and remains available through the page's date controls.
- The default output is `logs/html/dashboard-<start>-<end>.html`. Use `--out <path>` when an output path is requested.
- Run the command directly; inspect source, tests, or the database only if needed to troubleshoot generation or verification failures.
- Open the generated local HTML in a browser. Confirm that dashboard content renders and that one date preset updates the displayed view. No dev server is needed.
- Return a clickable link to the generated file and the initial date range. If browser verification is unavailable or fails, report that explicitly rather than claiming the page was verified.
