import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db/index.js";
import { getTransactionsWithDetails } from "../server/services/transactions/read.js";
import {
  INTERACTIVE_JS,
  REPORT_HTML_DIRECTORY,
  escapeHtml,
  formatMoney,
  parseReportArgs,
  reportUsage,
} from "./report-html-common.js";

export const MAX_HISTORY_ROWS = 50_000;

export function renderHistoryHtml(start: string, end: string): string {
  void getDb();
  const all = getTransactionsWithDetails({ startDate: start, endDate: end });
  const sorted = [...all].sort((a, b) =>
    a.date === b.date
      ? b.created_at.localeCompare(a.created_at)
      : b.date.localeCompare(a.date),
  );
  const truncated = sorted.length > MAX_HISTORY_ROWS;
  const visible = truncated ? sorted.slice(0, MAX_HISTORY_ROWS) : sorted;
  const generatedAt = new Date().toISOString();

  const rows = visible
    .map((t) => {
      const category =
        t.category_name != null
          ? `${t.category_name} > ${t.subcategory_name ?? "—"}`
          : "Unassigned";
      return `<tr><td>${escapeHtml(t.date)}</td><td>${escapeHtml(t.name)}</td><td data-v="${t.amount}">${escapeHtml(formatMoney(t.amount))}</td><td>${escapeHtml(t.account_name ?? t.account_id)}</td><td>${escapeHtml(category)}</td><td>${escapeHtml(t.comment ?? "")}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transaction history ${escapeHtml(start)} to ${escapeHtml(end)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:1100px;margin:0 auto;padding:24px}
table{width:100%;border-collapse:collapse;background:#fff;margin:12px 0;font-size:.88rem}
th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left}
th{background:#f1f5f9}
input[type=search]{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;margin:12px 0}
.banner{background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;padding:12px;margin:12px 0}
details{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:12px 0}
details>summary{cursor:pointer;font-weight:700}
</style>
</head>
<body>
<main>
<header>
<h1>Transaction history</h1>
<p><strong>Range:</strong> ${escapeHtml(start)} to ${escapeHtml(end)} · <strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
<p><strong>Transactions:</strong> ${visible.length}${truncated ? ` of ${sorted.length} (truncated to newest ${MAX_HISTORY_ROWS})` : ""}</p>
</header>
${truncated ? `<p class="banner" role="status">This report exceeded ${MAX_HISTORY_ROWS} rows; showing only the newest ${MAX_HISTORY_ROWS} transactions.</p>` : ""}
<input id="report-search" type="search" placeholder="Filter all rows…" aria-label="Filter all rows">
<details open><summary>Transactions (${visible.length})</summary>
<table data-sortable data-filterable>
<thead><tr><th>Date</th><th>Name</th><th data-numeric>Amount</th><th>Account</th><th>Category &gt; Subcategory</th><th>Comment</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</details>
</main>
${INTERACTIVE_JS}
</body>
</html>`;
}

export async function renderHistoryHtmlFile(
  start: string,
  end: string,
  out: string | null,
): Promise<string> {
  const html = renderHistoryHtml(start, end);
  const outputPath =
    out != null
      ? path.resolve(out)
      : path.join(REPORT_HTML_DIRECTORY, `history-${start}-${end}.html`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  return outputPath;
}

async function main(): Promise<void> {
  const args = parseReportArgs(process.argv.slice(2));
  if (!args) {
    console.error(reportUsage("report:history"));
    process.exitCode = 2;
    return;
  }
  try {
    const outputPath = await renderHistoryHtmlFile(
      args.start,
      args.end,
      args.out,
    );
    console.log(`Wrote ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
