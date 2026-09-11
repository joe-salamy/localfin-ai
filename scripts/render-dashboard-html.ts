import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db/index.js";
import {
  getAccountSummary,
  getCategorySummary,
  getDashboardMetrics,
} from "../server/services/dashboard.js";
import { prepareNetWorthData } from "../server/services/charts.js";
import { getSpendingGoalsWithDetails } from "../server/services/goals.js";
import {
  INTERACTIVE_JS,
  REPORT_HTML_DIRECTORY,
  escapeHtml,
  formatMoney,
  parseReportArgs,
  reportUsage,
} from "./report-html-common.js";

function netWorthSvg(
  points: Array<{ formattedDate: string; netWorth: number }>,
): string {
  if (points.length === 0) return "<p>No net-worth data.</p>";
  const width = 720;
  const height = 220;
  const pad = 36;
  const values = points.map((p) => p.netWorth);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const stepX =
    points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = pad + stepX * i;
    const y = height - pad - ((p.netWorth - min) / span) * (height - pad * 2);
    return { x, y };
  });
  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${(pad + stepX * (points.length - 1)).toFixed(1)},${height - pad} L${pad},${height - pad} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Net worth over time" style="width:100%;height:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
<path d="${area}" fill="#dbeafe" stroke="none"/>
<path d="${line}" fill="none" stroke="#2563eb" stroke-width="2"/>
<text x="${pad}" y="20" font-size="12" fill="#475569">Net worth: ${escapeHtml(formatMoney(first?.netWorth ?? 0))} → ${escapeHtml(formatMoney(last?.netWorth ?? 0))}</text>
<text x="${pad}" y="${height - 10}" font-size="11" fill="#64748b">${escapeHtml(first?.formattedDate ?? "")}</text>
<text x="${width - pad - 80}" y="${height - 10}" font-size="11" fill="#64748b">${escapeHtml(last?.formattedDate ?? "")}</text>
</svg>`;
}

function barsSvg(rows: Array<{ label: string; value: number }>): string {
  if (rows.length === 0) return "<p>No data.</p>";
  const width = 720;
  const rowH = 26;
  const height = rows.length * rowH + 30;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0) || 1;
  const bars = rows
    .map((r, i) => {
      const w = (Math.abs(r.value) / max) * (width - 260);
      const y = 24 + i * rowH;
      const color = r.value >= 0 ? "#16a34a" : "#dc2626";
      return `<text x="8" y="${y + 15}" font-size="12" fill="#0f172a">${escapeHtml(r.label.slice(0, 28))}</text><rect x="240" y="${y}" width="${w.toFixed(1)}" height="16" rx="4" fill="${color}"/><text x="${248 + w}" y="${y + 13}" font-size="11" fill="#475569">${escapeHtml(formatMoney(r.value))}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Ending balances" style="width:100%;height:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px">${bars}</svg>`;
}

export function renderDashboardHtml(start: string, end: string): string {
  void getDb();
  const metrics = getDashboardMetrics(start, end);
  const { accounts, netWorth } = getAccountSummary(start, end);
  const categories = getCategorySummary(start, end);
  const netWorthSeries = prepareNetWorthData(start, end);
  const goals = getSpendingGoalsWithDetails();
  const generatedAt = new Date().toISOString();

  const accountRows = accounts
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.account_name)}</td><td>${escapeHtml(a.account_type)}</td><td data-v="${a.starting_balance}">${escapeHtml(formatMoney(a.starting_balance))}</td><td data-v="${a.total_change}">${escapeHtml(formatMoney(a.total_change))}</td><td data-v="${a.ending_balance}">${escapeHtml(formatMoney(a.ending_balance))}</td></tr>`,
    )
    .join("\n");

  const categoryRows = categories
    .map((c) => {
      const subs = c.subcategories
        .map(
          (s) =>
            `<tr><td>${escapeHtml(c.category_name)} &gt; ${escapeHtml(s.subcategory_name)}</td><td>${escapeHtml(c.category_type)}</td><td data-v="${s.total}">${escapeHtml(formatMoney(s.total))}</td><td>${s.goal == null ? "—" : escapeHtml(formatMoney(s.goal))}</td><td>${s.difference == null ? "—" : escapeHtml(formatMoney(s.difference))}</td></tr>`,
        )
        .join("\n");
      return `<tr><td><strong>${escapeHtml(c.category_name)}</strong></td><td>${escapeHtml(c.category_type)}</td><td data-v="${c.total}"><strong>${escapeHtml(formatMoney(c.total))}</strong></td><td>${c.goal == null ? "—" : escapeHtml(formatMoney(c.goal))}</td><td>${c.difference == null ? "—" : escapeHtml(formatMoney(c.difference))}</td></tr>\n${subs}`;
    })
    .join("\n");

  const goalRows =
    goals.length === 0
      ? `<tr><td colspan="4">No spending goals.</td></tr>`
      : goals
          .map(
            (g) =>
              `<tr><td>${escapeHtml(g.category_name)} &gt; ${escapeHtml(g.subcategory_name)}</td><td>${escapeHtml(g.period)}</td><td data-v="${g.amount}">${escapeHtml(formatMoney(g.amount))}</td><td>${escapeHtml(g.start_date)}${g.end_date ? ` to ${escapeHtml(g.end_date)}` : ""}</td></tr>`,
          )
          .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard ${escapeHtml(start)} to ${escapeHtml(end)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:1000px;margin:0 auto;padding:24px}
header.page{margin-bottom:16px}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0}
.metric{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
.metric .k{font-size:.75rem;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
.metric .v{font-size:1.25rem;font-weight:700}
table{width:100%;border-collapse:collapse;background:#fff;margin:12px 0;font-size:.9rem}
th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left}
th{background:#f1f5f9}
input[type=search]{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;margin:12px 0}
details{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:12px 0}
details>summary{cursor:pointer;font-weight:700}
</style>
</head>
<body>
<main>
<header class="page">
<h1>Dashboard</h1>
<p><strong>Range:</strong> ${escapeHtml(start)} to ${escapeHtml(end)} · <strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
</header>
<input id="report-search" type="search" placeholder="Filter all rows…" aria-label="Filter all rows">
<section class="metrics">
<div class="metric"><div class="k">Income</div><div class="v">${escapeHtml(formatMoney(metrics.totalIncome))}</div></div>
<div class="metric"><div class="k">Expenses</div><div class="v">${escapeHtml(formatMoney(metrics.totalExpenses))}</div></div>
<div class="metric"><div class="k">Net change</div><div class="v">${escapeHtml(formatMoney(metrics.netChange))}</div></div>
<div class="metric"><div class="k">Net worth</div><div class="v">${escapeHtml(formatMoney(netWorth.net_worth))}</div></div>
</section>
<details open><summary>Net worth over time (${netWorthSeries.length} points)</summary>${netWorthSvg(netWorthSeries)}</details>
<details open><summary>Account balances</summary>${barsSvg(accounts.map((a) => ({ label: a.account_name, value: a.ending_balance })))}</details>
<details open><summary>Accounts (${accounts.length})</summary>
<table data-sortable data-filterable>
<thead><tr><th>Account</th><th>Type</th><th data-numeric>Starting</th><th data-numeric>Change</th><th data-numeric>Ending</th></tr></thead>
<tbody>${accountRows}</tbody>
</table>
</details>
<details open><summary>Categories &amp; subcategories (${categories.length})</summary>
<table data-sortable data-filterable>
<thead><tr><th>Category &gt; Subcategory</th><th>Type</th><th data-numeric>Total</th><th>Goal</th><th>Difference</th></tr></thead>
<tbody>${categoryRows}</tbody>
</table>
</details>
<details><summary>Spending goals (${goals.length})</summary>
<table data-sortable data-filterable>
<thead><tr><th>Name</th><th>Period</th><th data-numeric>Target</th><th>Subcategory</th></tr></thead>
<tbody>${goalRows}</tbody>
</table>
</details>
</main>
${INTERACTIVE_JS}
</body>
</html>`;
}

export async function renderDashboardHtmlFile(
  start: string,
  end: string,
  out: string | null,
): Promise<string> {
  const html = renderDashboardHtml(start, end);
  const outputPath =
    out != null
      ? path.resolve(out)
      : path.join(REPORT_HTML_DIRECTORY, `dashboard-${start}-${end}.html`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  return outputPath;
}

async function main(): Promise<void> {
  const args = parseReportArgs(process.argv.slice(2));
  if (!args) {
    console.error(reportUsage("report:dashboard"));
    process.exitCode = 2;
    return;
  }
  try {
    const outputPath = await renderDashboardHtmlFile(
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
