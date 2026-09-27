import path from "node:path";
import process from "node:process";
import { isIsoDate, isWithinReportSpan } from "../shared/validation.js";

export const REPORT_HTML_DIRECTORY = path.resolve(
  process.cwd(),
  "logs",
  "html",
);

interface ReportArgs {
  start: string;
  end: string;
  out: string | null;
}

export function parseReportArgs(argv: string[]): ReportArgs | null {
  let start: string | null = null;
  let end: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--start" || arg === "--end" || arg === "--out") {
      const value = argv[i + 1] ?? null;
      if (arg === "--start") start = value;
      else if (arg === "--end") end = value;
      else out = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      return null;
    } else {
      return null;
    }
  }
  if (!start || !end) return null;
  if (!isIsoDate(start) || !isIsoDate(end)) return null;
  if (start > end) return null;
  if (!isWithinReportSpan(start, end)) return null;
  return { start, end, out };
}

export function reportUsage(cmd: "report:dashboard" | "report:history"): string {
  return `Usage: ${cmd} --start YYYY-MM-DD --end YYYY-MM-DD [--out path]`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatMoney(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const INTERACTIVE_JS = `<script>
(function(){
var search=document.getElementById("report-search");
function rowsOf(table){return Array.prototype.slice.call(table.querySelectorAll("tbody tr"));}
function applyFilter(){var q=(search.value||"").toLowerCase();document.querySelectorAll("table[data-filterable]").forEach(function(t){rowsOf(t).forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)>=0?"":"none";});});}
if(search){search.addEventListener("input",applyFilter);}
document.querySelectorAll("table[data-sortable] th").forEach(function(th,idx){th.style.cursor="pointer";th.addEventListener("click",function(){var table=th.closest("table");var tbody=table.querySelector("tbody");var rows=rowsOf(table);var dir=th.getAttribute("data-dir")==="asc"?"desc":"asc";table.querySelectorAll("th").forEach(function(h){h.removeAttribute("data-dir");});th.setAttribute("data-dir",dir);var numeric=th.hasAttribute("data-numeric");rows.sort(function(a,b){var x=a.cells[idx].textContent.trim();var y=b.cells[idx].textContent.trim();if(numeric){var nx=parseFloat(x.replace(/[^0-9.-]/g,""))||0;var ny=parseFloat(y.replace(/[^0-9.-]/g,""))||0;return dir==="asc"?nx-ny:ny-nx;}if(x<y)return dir==="asc"?-1:1;if(x>y)return dir==="asc"?1:-1;return 0;});rows.forEach(function(r){tbody.appendChild(r);});});});
})();
</script>`;
