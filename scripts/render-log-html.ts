import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

export type LogEvent = Record<string, unknown>;

type PromptClass =
  | "prompt-system"
  | "prompt-user-request"
  | "prompt-context"
  | "prompt-tools"
  | "prompt-rules"
  | "prompt-examples"
  | "prompt-code"
  | "prompt-response"
  | "prompt-metadata"
  | "prompt-unknown";

interface PromptStyle {
  label: string;
  background: string;
  border: string;
}

interface PromptMessage {
  role: string;
  content: string;
}

interface PromptSegment {
  className: PromptClass;
  content: string;
}

const PROMPT_STYLES: Record<PromptClass, PromptStyle> = {
  "prompt-system": {
    label: "System prompt",
    background: "#eef2ff",
    border: "#6366f1",
  },
  "prompt-user-request": {
    label: "User request",
    background: "#ecfdf5",
    border: "#10b981",
  },
  "prompt-context": {
    label: "Context",
    background: "#eff6ff",
    border: "#3b82f6",
  },
  "prompt-tools": {
    label: "Tools / actions",
    background: "#f5f3ff",
    border: "#8b5cf6",
  },
  "prompt-rules": {
    label: "Rules / constraints",
    background: "#fff7ed",
    border: "#f97316",
  },
  "prompt-examples": {
    label: "Examples",
    background: "#f0fdfa",
    border: "#14b8a6",
  },
  "prompt-code": {
    label: "Code / JSON",
    background: "#f8fafc",
    border: "#64748b",
  },
  "prompt-response": {
    label: "Assistant response",
    background: "#f0fdf4",
    border: "#22c55e",
  },
  "prompt-metadata": {
    label: "Metadata",
    background: "#f1f5f9",
    border: "#94a3b8",
  },
  "prompt-unknown": {
    label: "Prompt text",
    background: "#fafafa",
    border: "#a3a3a3",
  },
};

const TAG_CLASS_MAP = new Map<string, PromptClass>([
  ["tools", "prompt-tools"],
  ["tool", "prompt-tools"],
  ["function", "prompt-tools"],
  ["functions", "prompt-tools"],
  ["action", "prompt-tools"],
  ["actions", "prompt-tools"],
  ["context", "prompt-context"],
  ["project", "prompt-context"],
  ["workstation", "prompt-context"],
  ["file", "prompt-context"],
  ["harness", "prompt-context"],
  ["rules", "prompt-rules"],
  ["rule", "prompt-rules"],
  ["critical", "prompt-rules"],
  ["constraints", "prompt-rules"],
  ["contract", "prompt-rules"],
  ["directives", "prompt-rules"],
  ["caution", "prompt-rules"],
  ["system-conventions", "prompt-rules"],
  ["examples", "prompt-examples"],
  ["example", "prompt-examples"],
]);

const USER_PROMPT_ORDER: Array<[key: string, className: PromptClass]> = [
  ["message", "prompt-user-request"],
  ["currentPage", "prompt-metadata"],
  ["history", "prompt-context"],
  ["context", "prompt-context"],
  ["instruction", "prompt-rules"],
  ["previousTurns", "prompt-tools"],
];

const RESPONSE_KEYS = [
  "responseText",
  "partialResponseText",
  "parsedResponse",
  "rawResponse",
  "reasoning",
  "reasoningDetails",
  "streamChunks",
  "usage",
  "error",
] as const;

const HEADER_KEYS = [
  "operation",
  "status",
  "timestamp",
  "completedAt",
  "durationMs",
  "model",
  "requestId",
  "conversationId",
] as const;

const LOG_HTML_DIRECTORY = path.resolve(process.cwd(), "logs", "html");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireLogEvent(value: unknown, index: number): LogEvent {
  if (isRecord(value)) {
    return value;
  }
  throw new Error(
    `Unsupported log entry at index ${index}: expected an object`,
  );
}

function parseEventArray(value: unknown[]): LogEvent[] {
  return value.map((entry, index) => requireLogEvent(entry, index));
}

function parseJsonLines(text: string): LogEvent[] {
  const events: LogEvent[] = [];
  const lines = text.split(/\r?\n/);

  for (const [zeroBasedIndex, line] of lines.entries()) {
    if (line.trim() === "") {
      continue;
    }

    try {
      events.push(requireLogEvent(parseJson(line), zeroBasedIndex));
    } catch (error) {
      if (messageFromError(error).startsWith("Unsupported log entry")) {
        throw error;
      }
      throw new Error(
        `Invalid JSON on line ${zeroBasedIndex + 1}: ${messageFromError(error)}`,
      );
    }
  }

  return events;
}

export function parseLogText(text: string, inputPath: string): LogEvent[] {
  const trimmed = text.trimStart();

  if (trimmed === "") {
    return [];
  }

  const firstChar = trimmed.at(0);
  const isJsonLines =
    path.extname(inputPath).toLowerCase() === ".jsonl" ||
    (firstChar !== "[" && firstChar !== "{");

  if (isJsonLines) {
    return parseJsonLines(text);
  }

  const parsed = parseJson(text);

  if (Array.isArray(parsed)) {
    return parseEventArray(parsed);
  }

  if (isRecord(parsed)) {
    for (const key of ["events", "entries", "messages"] as const) {
      const candidate = parsed[key];
      if (Array.isArray(candidate)) {
        return parseEventArray(candidate);
      }
    }

    return [parsed];
  }

  throw new Error(
    "Unsupported log JSON shape: expected an array, { events }, { entries }, { messages }, or one event object.",
  );
}

export function outputPathFor(inputPath: string): string {
  return path.join(
    LOG_HTML_DIRECTORY,
    `${path.basename(inputPath, path.extname(inputPath))}.html`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderMarkdown(value: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { children: value }),
  );
}

function renderPreformatted(value: unknown): string {
  return `<pre>${escapeHtml(prettyJson(value))}</pre>`;
}

function stringAsJsonObjectOrArray(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    const parsed = parseJson(trimmed);
    if (Array.isArray(parsed) || isRecord(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function renderValue(value: unknown): string {
  if (typeof value === "string") {
    const parsed = stringAsJsonObjectOrArray(value);
    if (parsed !== null) {
      return renderPreformatted(parsed);
    }
    return renderMarkdown(value);
  }

  if (Array.isArray(value) || isRecord(value)) {
    return renderPreformatted(value);
  }

  return escapeHtml(String(value));
}

function defaultPromptClassForRole(role: string): PromptClass {
  if (role === "system") {
    return "prompt-system";
  }
  if (role === "assistant") {
    return "prompt-response";
  }
  return "prompt-unknown";
}

function tagClassFor(tagName: string): PromptClass {
  return TAG_CLASS_MAP.get(tagName.toLowerCase()) ?? "prompt-unknown";
}

function sectionEndIndex(lines: string[], startIndex: number): number {
  let endIndex = startIndex;
  while (endIndex + 1 < lines.length && lines[endIndex + 1].trim() !== "") {
    endIndex += 1;
  }
  return endIndex;
}

function findClosingTagLine(
  lines: string[],
  startIndex: number,
  tagName: string,
): number | null {
  const closingPattern = new RegExp(
    `^</${tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>$`,
    "i",
  );

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (closingPattern.test(lines[index].trim())) {
      return index;
    }
  }

  return null;
}

function recognizedSegmentAt(
  lines: string[],
  startIndex: number,
): { endIndex: number; className: PromptClass } | null {
  const line = lines[startIndex];
  const trimmed = line.trim();
  const tagMatch = /^<([A-Za-z][\w:-]*)(?:\s[^>]*)?>$/.exec(trimmed);

  if (tagMatch) {
    const closingIndex = findClosingTagLine(lines, startIndex, tagMatch[1]);
    if (closingIndex !== null) {
      return {
        endIndex: closingIndex,
        className: tagClassFor(tagMatch[1]),
      };
    }
  }

  const fenceMatch = /^(?:```|~~~)/.exec(trimmed);
  if (fenceMatch) {
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (lines[index].trim().startsWith(fenceMatch[0])) {
        return { endIndex: index, className: "prompt-code" };
      }
    }
    return { endIndex: lines.length - 1, className: "prompt-code" };
  }

  if (trimmed === "Amount conventions:" || trimmed === "Failure conventions:") {
    return {
      endIndex: sectionEndIndex(lines, startIndex),
      className: "prompt-rules",
    };
  }

  if (trimmed === "Allowed action types:") {
    return {
      endIndex: sectionEndIndex(lines, startIndex),
      className: "prompt-tools",
    };
  }

  if (trimmed.startsWith("Transaction search supports")) {
    return {
      endIndex: sectionEndIndex(lines, startIndex),
      className: "prompt-tools",
    };
  }

  if (trimmed.startsWith("Use today's date ")) {
    return { endIndex: startIndex, className: "prompt-rules" };
  }

  return null;
}

function segmentPromptText(content: string, role: string): PromptSegment[] {
  const lines = content.split(/\r?\n/);
  const segments: PromptSegment[] = [];
  const defaultClassName = defaultPromptClassForRole(role);
  let index = 0;

  while (index < lines.length) {
    const recognized = recognizedSegmentAt(lines, index);
    if (recognized !== null) {
      segments.push({
        className: recognized.className,
        content: lines.slice(index, recognized.endIndex + 1).join("\n"),
      });
      index = recognized.endIndex + 1;
      continue;
    }

    const startIndex = index;
    index += 1;
    while (index < lines.length && recognizedSegmentAt(lines, index) === null) {
      index += 1;
    }

    const contentSlice = lines.slice(startIndex, index).join("\n");
    if (contentSlice.trim() !== "") {
      segments.push({ className: defaultClassName, content: contentSlice });
    }
  }

  return segments;
}

function renderPromptCard(className: PromptClass, body: string): string {
  const style = PROMPT_STYLES[className];
  return `<section class="prompt-card ${className}"><h4>${escapeHtml(style.label)}</h4><div class="prompt-body">${body}</div></section>`;
}

function renderPromptSegments(segments: PromptSegment[]): string {
  return segments
    .map((segment) =>
      renderPromptCard(segment.className, renderMarkdown(segment.content)),
    )
    .join("\n");
}

function isEmptyPromptValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  );
}

function renderUserPromptJson(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = parseJson(content);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const rendered: string[] = [];
  const consumedKeys = new Set<string>();

  for (const [key, className] of USER_PROMPT_ORDER) {
    if (!(key in parsed) || isEmptyPromptValue(parsed[key])) {
      continue;
    }

    consumedKeys.add(key);
    const value = parsed[key];
    const body =
      key === "message" && typeof value === "string"
        ? renderMarkdown(value)
        : renderValue(value);
    rendered.push(renderPromptCard(className, body));
  }

  const remainingKeys = Object.keys(parsed)
    .filter((key) => !consumedKeys.has(key))
    .sort((first, second) => first.localeCompare(second));

  for (const key of remainingKeys) {
    if (isEmptyPromptValue(parsed[key])) {
      continue;
    }

    rendered.push(
      renderPromptCard(
        "prompt-metadata",
        `<h5>${escapeHtml(key)}</h5>${renderValue(parsed[key])}`,
      ),
    );
  }

  return rendered.join("\n");
}

function renderPromptMessage(message: PromptMessage, index: number): string {
  const role = message.role.toLowerCase();
  const body =
    role === "user"
      ? (renderUserPromptJson(message.content) ??
        renderPromptSegments(segmentPromptText(message.content, role)))
      : renderPromptSegments(segmentPromptText(message.content, role));

  return `<details class="subsection" open><summary>Prompt ${index + 1}: ${escapeHtml(message.role)}</summary>${body}</details>`;
}

function requestMessagesFor(event: LogEvent): PromptMessage[] {
  const request = event.request;
  if (!isRecord(request) || !Array.isArray(request.messages)) {
    return [];
  }

  return request.messages.flatMap((message): PromptMessage[] => {
    if (!isRecord(message)) {
      return [];
    }

    const role = message.role;
    const content = message.content;
    if (typeof role !== "string" || typeof content !== "string") {
      return [];
    }

    return [{ role, content }];
  });
}

function renderPrompts(event: LogEvent): string {
  const messages = requestMessagesFor(event);
  if (messages.length === 0) {
    return "";
  }

  return `<section class="event-section"><h3>Prompts</h3>${messages
    .map(renderPromptMessage)
    .join("\n")}</section>`;
}

function renderResponses(event: LogEvent): string {
  const cards = RESPONSE_KEYS.flatMap((key): string[] => {
    if (!(key in event)) {
      return [];
    }

    return [
      renderPromptCard(
        key === "usage" ? "prompt-metadata" : "prompt-response",
        `<h5>${escapeHtml(key)}</h5>${renderValue(event[key])}`,
      ),
    ];
  });

  if (cards.length === 0) {
    return "";
  }

  return `<section class="event-section"><h3>Response</h3>${cards.join("\n")}</section>`;
}

function renderActions(event: LogEvent): string {
  if (!("actions" in event)) {
    return "";
  }

  return `<section class="event-section"><h3>Tools / actions</h3>${renderPromptCard(
    "prompt-tools",
    renderValue(event.actions),
  )}</section>`;
}

function renderMetadata(event: LogEvent): string {
  return `<details class="subsection full-json"><summary>Full JSON</summary><pre>${escapeHtml(prettyJson(event))}</pre></details>`;
}

function valueForHeader(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return prettyJson(value);
}

function statusClassFor(status: unknown): string {
  if (typeof status !== "string" || status.trim() === "") {
    return "unknown";
  }
  return status.toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "-");
}

function renderEventHeader(event: LogEvent, index: number): string {
  const status = typeof event.status === "string" ? event.status : "unknown";
  const operation =
    typeof event.operation === "string" ? event.operation : "Log event";
  const headerRows = HEADER_KEYS.flatMap((key): string[] => {
    if (!(key in event)) {
      return [];
    }

    return [
      `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(valueForHeader(event[key]))}</dd>`,
    ];
  });

  return `<header class="event-header"><div><p class="event-index">Event ${index + 1}</p><h2>${escapeHtml(operation)}</h2></div><span class="status-pill status-text-${escapeHtml(statusClassFor(status))}">${escapeHtml(status)}</span></header><dl class="event-meta">${headerRows.join("\n")}</dl>`;
}

function renderEvent(event: LogEvent, index: number): string {
  const statusClass = statusClassFor(event.status);
  return `<article class="event status-${escapeHtml(statusClass)}">${renderEventHeader(
    event,
    index,
  )}${renderPrompts(event)}${renderResponses(event)}${renderActions(
    event,
  )}${renderMetadata(event)}</article>`;
}

function cssForPromptClasses(): string {
  return Object.entries(PROMPT_STYLES)
    .map(
      ([className, style]) => `.${className} {
  background: ${style.background};
  border-left-color: ${style.border};
}`,
    )
    .join("\n");
}

function renderDocument(sourcePath: string, events: LogEvent[]): string {
  const title = `Log viewer: ${path.basename(sourcePath)}`;
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f8fafc;
  color: #0f172a;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: #f8fafc;
  color: #0f172a;
}
main {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0 48px;
}
.page-header,
.event {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 16px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}
.page-header {
  padding: 24px;
  margin-bottom: 24px;
}
h1,
h2,
h3,
h4,
h5,
p {
  margin-top: 0;
}
h1 {
  margin-bottom: 12px;
  font-size: clamp(2rem, 4vw, 3rem);
}
.source-path {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
.event {
  margin: 20px 0;
  padding: 22px;
}
.event-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
}
.event-index {
  margin-bottom: 4px;
  color: #475569;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.status-pill {
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.875rem;
  font-weight: 700;
  white-space: nowrap;
}
.status-text-success {
  color: #15803d;
}
.status-text-error {
  color: #b91c1c;
}
.status-text-partial {
  color: #b45309;
}
.status-text-unknown {
  color: #475569;
}
.event-meta {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 12px;
  margin: 16px 0 0;
}
.event-meta dt {
  color: #475569;
  font-weight: 700;
}
.event-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
.event-section {
  margin-top: 22px;
}
.subsection {
  margin: 14px 0;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px;
}
.subsection > summary {
  cursor: pointer;
  font-weight: 800;
}
.prompt-card {
  margin: 12px 0;
  border-left: 5px solid;
  border-radius: 10px;
  padding: 14px 16px;
}
.prompt-card h4 {
  margin-bottom: 10px;
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.prompt-card h5 {
  margin-bottom: 8px;
  font-size: 0.95rem;
}
.prompt-body p {
  white-space: pre-line;
}
.prompt-body > :last-child,
.prompt-body p:last-child {
  margin-bottom: 0;
}
pre {
  max-width: 100%;
  overflow-x: auto;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 14px;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 0.875rem;
  line-height: 1.55;
}
code {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
.full-json {
  margin-top: 22px;
  background: #f8fafc;
}
${cssForPromptClasses()}
</style>
</head>
<body>
<main>
<header class="page-header">
<h1>Log viewer</h1>
<p class="source-path"><strong>Source:</strong> ${escapeHtml(sourcePath)}</p>
<p><strong>Events:</strong> ${events.length} events</p>
<p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
</header>
${events.map(renderEvent).join("\n")}
</main>
</body>
</html>
`;
}

export function renderLogHtml(events: LogEvent[], sourcePath: string): string {
  return renderDocument(sourcePath, events);
}

export async function renderLogHtmlFile(rawInputPath: string): Promise<string> {
  const inputPath = path.resolve(rawInputPath);
  let fileStat;

  try {
    fileStat = await stat(inputPath);
  } catch {
    throw new Error(`Log file not found: ${inputPath}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Log file not found: ${inputPath}`);
  }

  const text = await readFile(inputPath, "utf8");
  const events = parseLogText(text, inputPath);
  const outputPath = outputPathFor(inputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderLogHtml(events, inputPath), "utf8");
  return outputPath;
}

async function main(): Promise<void> {
  const rawInputPath = process.argv[2];
  if (!rawInputPath) {
    console.error("Usage: npm run log:view -- <path-to-log.json-or-jsonl>");
    process.exitCode = 1;
    return;
  }

  try {
    const outputPath = await renderLogHtmlFile(rawInputPath);
    console.log(`Wrote ${outputPath}`);
  } catch (error) {
    console.error(messageFromError(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
