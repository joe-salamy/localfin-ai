# Log HTML Viewer Plan

## Context

The requested change is a local CLI that accepts a path to a `log.json` file and generates a corresponding readable HTML file in the same folder. The generated HTML must render Markdown content and color-coordinate semantic portions of prompts, especially system/tool/context/user-request sections.

User preferences already settled: expose the script through `package.json` as an npm CLI entry, default output path is the same directory as the input (`log.html`), use semantic section colors rather than per-tag randomness, and print the full log contents without redaction.

## Findings confirmed

- `package.json` uses ESM (`"type": "module"`) and existing scripts run through `tsx`; the new CLI should follow that pattern and add a package script beside `eval:agent:live` (`package.json:5-15`).
- Existing scripts live in `scripts/` and use Node built-ins with explicit `node:` imports; match that style (`scripts/agent-live-eval.ts:1-5`, `scripts/repair-account-type-transaction-signs.ts:1-4`).
- The app already depends on `react`, `react-dom`, and `react-markdown`, so Markdown can be rendered server-side without adding a dependency (`package.json:27-30`).
- Current OpenRouter conversation logs are JSON Lines files under `logs/` with `*.jsonl` names, not plain `log.json`; each line is one event appended by `appendConversationLog` (`server/ai/openrouter.ts:122-140`).
- OpenRouter success/error events include `timestamp`, `completedAt`, `durationMs`, `status`, `provider`, `operation`, `model`, `conversationId`, `requestId`, `request`, response fields (`rawResponse`, `responseText`, `parsedResponse`, `reasoning`, `reasoningDetails`, `streamChunks`, `usage`), `metadata`, and/or `error` depending on path (`server/ai/openrouter.ts:214-286`, `server/ai/openrouter.ts:340-480`).
- `request.messages` is the prompt payload shape: a system message from `assistantSystemMessage()` and a user message whose `content` is JSON containing `currentPage`, `history`, `message`, `context`, and optionally `instruction` plus `previousTurns` (`server/services/ai-chat/prompting.ts:181-230`).
- Tool/action events are appended separately with `operation: "assistant.tool_actions"` and an `actions` array (`server/services/ai-chat/chat-runner.ts:185-194`).

## Approach

### Add the CLI entry point and preserve existing script conventions

1. In `package.json`, add one script entry immediately after `eval:agent:live`:
   - Exact key/value: `"log:view": "tsx scripts/render-log-html.ts"`.
   - Keep the existing ESM package mode and do not add dependencies.
   - Invocation after implementation: `npm run log:view -- <path-to-log.json-or-jsonl>`.

2. Add `scripts/render-log-html.ts` as an ESM TypeScript Node script. Use explicit Node imports matching existing script style:
   - `node:fs/promises`: `readFile`, `writeFile`, `stat`
   - `node:path`
   - `node:process`
   - `node:url`: `fileURLToPath`
   - `react`: `createElement`
   - `react-dom/server`: `renderToStaticMarkup`
   - `react-markdown`: default import, named locally as `ReactMarkdown`

3. Make the CLI non-destructive and deterministic:
   - If no input path is provided, print `Usage: npm run log:view -- <path-to-log.json-or-jsonl>` to stderr and set `process.exitCode = 1`.
   - Resolve the input path with `path.resolve(rawInput)`.
   - Before reading, call `stat(inputPath)` and fail with `Log file not found: ${inputPath}` when the file is missing or not a file.
   - Default output path is the same directory and the same basename with `.html` extension: `path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}.html`)`. This yields `log.html` for `log.json` and avoids collisions for existing `logs/*.jsonl` files by producing `logs/<same-log-name>.html`.
   - After writing, print `Wrote ${outputPath}` to stdout.
   - Do not implement redaction, upload, CDN usage, telemetry, or network calls.

### Parse the existing logs and reasonable `log.json` variants

4. In `scripts/render-log-html.ts`, export these symbols so the test can exercise behavior without spawning a subprocess:
   - `export type LogEvent = Record<string, unknown>;`
   - `export function parseLogText(text: string, inputPath: string): LogEvent[]`
   - `export function outputPathFor(inputPath: string): string`
   - `export function renderLogHtml(events: LogEvent[], sourcePath: string): string`
   - `export async function renderLogHtmlFile(rawInputPath: string): Promise<string>`

5. `parseLogText` behavior:
   - Treat `.jsonl` input, or any input whose first non-whitespace character is not `[` or `{`, as JSON Lines.
   - For JSON Lines, split on `\r?\n`, drop blank lines, parse each line with `JSON.parse`, and require every parsed value to be a non-null object. On parse failure, throw `Invalid JSON on line ${lineNumber}: ${message}`.
   - For JSON input, parse the whole file. Accept these shapes, in this order:
     1. top-level array of event objects,
     2. `{ events: [...] }`,
     3. `{ entries: [...] }`,
     4. `{ messages: [...] }`,
     5. one non-null object, treated as a single event.
   - Reject arrays containing non-object entries with `Unsupported log entry at index ${index}: expected an object`.
   - Reject any other JSON shape with `Unsupported log JSON shape: expected an array, { events }, { entries }, { messages }, or one event object.`
   - Preserve input order exactly; do not sort by timestamp.
   - Empty files and empty arrays are valid and render an HTML page with `0 events`.

6. Normalize display at render time only; do not mutate parsed events. For each event, derive:
   - Header fields: 1-based index, `operation`, `status`, `timestamp`, `completedAt`, `durationMs`, `model`, `requestId`, `conversationId`.
   - Prompt section from `event.request.messages` when it is an array of objects with string `role` and `content`.
   - Response section from `responseText`, `partialResponseText`, `parsedResponse`, `rawResponse`, `reasoning`, `reasoningDetails`, `streamChunks`, `usage`, and `error` when present.
   - Tool/actions section from `actions` when present.
   - Metadata/details section containing the full event JSON in a collapsed `<details>` block for fidelity.

### Render Markdown and semantic prompt colors

7. Implement a small HTML-rendering layer in `scripts/render-log-html.ts`:
   - `escapeHtml(value: string): string` for all attribute values and preformatted JSON.
   - `renderMarkdown(value: string): string` using `renderToStaticMarkup(createElement(ReactMarkdown, { children: value }))`. `react-markdown` escapes raw HTML by default; keep that default.
   - `prettyJson(value: unknown): string` returning `JSON.stringify(value, null, 2)`.
   - `renderValue(value: unknown): string`:
     - strings that are valid JSON objects/arrays render as syntax-neutral pretty JSON inside `<pre>`;
     - other strings render through `renderMarkdown`;
     - objects/arrays render as pretty JSON inside `<pre>`;
     - primitive values render as escaped text.

8. Implement semantic color segmentation with deterministic categories. Use these exact classes, labels, background colors, and left-border colors:
   - `prompt-system` label `System prompt`, background `#eef2ff`, border `#6366f1`
   - `prompt-user-request` label `User request`, background `#ecfdf5`, border `#10b981`
   - `prompt-context` label `Context`, background `#eff6ff`, border `#3b82f6`
   - `prompt-tools` label `Tools / actions`, background `#f5f3ff`, border `#8b5cf6`
   - `prompt-rules` label `Rules / constraints`, background `#fff7ed`, border `#f97316`
   - `prompt-examples` label `Examples`, background `#f0fdfa`, border `#14b8a6`
   - `prompt-code` label `Code / JSON`, background `#f8fafc`, border `#64748b`
   - `prompt-response` label `Assistant response`, background `#f0fdf4`, border `#22c55e`
   - `prompt-metadata` label `Metadata`, background `#f1f5f9`, border `#94a3b8`
   - `prompt-unknown` label `Prompt text`, background `#fafafa`, border `#a3a3a3`

9. For user prompt content, first try `JSON.parse(content)`:
   - If parse succeeds and yields an object, render the recognized keys in this fixed order:
     1. `message` as `User request` through `renderMarkdown`.
     2. `currentPage` as `Metadata`.
     3. `history` as `Context`.
     4. `context` as `Context`.
     5. `instruction` as `Rules / constraints`.
     6. `previousTurns` as `Tools / actions`.
     7. Any remaining keys, alphabetically, as `Metadata`.
   - If parse fails, fall back to generic prompt text segmentation.

10. For system/assistant/raw prompt text, implement `segmentPromptText(content: string, role: string)` with this deterministic line-based behavior:
    - Recognize XML-like block starts on a line by themselves: `^<([A-Za-z][\w:-]*)(?:\s[^>]*)?>$`; if a matching closing tag exists, the segment spans start through the closing line.
    - Map tag names case-insensitively:
      - `tools`, `tool`, `function`, `functions`, `action`, `actions` → `prompt-tools`
      - `context`, `project`, `workstation`, `file`, `harness` → `prompt-context`
      - `rules`, `rule`, `critical`, `constraints`, `contract`, `directives`, `caution`, `system-conventions` → `prompt-rules`
      - `examples`, `example` → `prompt-examples`
      - unknown tags → `prompt-unknown`
    - Recognize Markdown fenced code blocks starting with a fence of three backticks or `~~~` and render them as one `prompt-code` segment.
    - Recognize LocalFin prompt headings from `assistantSystemMessage()`:
      - `Amount conventions:` → `prompt-rules`
      - `Failure conventions:` → `prompt-rules`
      - `Allowed action types:` → `prompt-tools`
      - `Transaction search supports` paragraph → `prompt-tools` until the next blank line.
    - Text before or between recognized segments stays in a segment whose class is `prompt-system` for role `system`, `prompt-response` for role `assistant`, and `prompt-unknown` otherwise.
    - Render each segment body through `renderMarkdown` so Markdown inside prompts becomes HTML.

11. Build the output HTML as a standalone document:
    - Include `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, and `<title>Log viewer: ${basename(sourcePath)}</title>`.
    - Add inline CSS only. Use page background `#f8fafc`, body text `#0f172a`, event border `#cbd5e1`, success status text `#15803d`, error status text `#b91c1c`, partial status text `#b45309`, monospace `<pre>` blocks with horizontal overflow, and the semantic prompt colors from step 8.
    - Use native `<details>/<summary>` for collapsible event subsections and full JSON; do not add JavaScript.
    - Top-level page header shows source path, event count, and generation timestamp.
    - Each event renders as `<article class="event status-${status}">` with a summary header, prompt cards, response cards, action cards, and a collapsed full JSON block.
    - Full JSON must always be present so the HTML is more readable without losing original detail.

### Add focused tests for the new behavior

12. Add `scripts/render-log-html.test.ts` using `node:test` and `node:assert/strict`. The test file must import `parseLogText`, `outputPathFor`, `renderLogHtml`, and `renderLogHtmlFile` from `./render-log-html.ts`.

13. Cover these cases exactly:
    - `outputPathFor("C:/tmp/log.json")` ends with `log.html`; `outputPathFor("C:/tmp/2026-01-01_chat.jsonl")` ends with `2026-01-01_chat.html`.
    - JSON Lines fixture with one `assistant.chat` event containing:
      - system message content with `Allowed action types:` and a `<tools>...</tools>` block,
      - user message content as JSON with `message: "Add **coffee** to groceries"`, `currentPage`, `context`, and `previousTurns`,
      - `responseText: "**Done**"`,
      - `actions` with one sample action.
        Assert generated HTML includes `Allowed action types`, `Tools / actions`, `User request`, `Context`, `<strong>coffee</strong>`, `<strong>Done</strong>`, and the action type.
    - JSON fixture shaped as `{ "messages": [...] }` parses as one event per message object.
    - Invalid JSON Lines input throws an error whose message starts with `Invalid JSON on line 2:`.
    - `renderLogHtmlFile` writes the `.html` file beside a temp `.jsonl` input and returns the output path.

14. Keep tests local to the script. Do not add mocks; write real temporary files with `mkdtemp`, `writeFile`, `readFile`, and clean them with `rm` in `t.after`.

## Critical files & anchors

- `package.json:6-15` — add the `log:view` npm script beside existing `tsx` script entries.
- `scripts/render-log-html.ts` — new CLI, parser, semantic segmenter, Markdown renderer, and standalone HTML generator.
- `scripts/render-log-html.test.ts` — new focused Node test covering JSONL parsing, JSON fallback shapes, Markdown rendering, semantic color labels, and output-file writing.
- `server/ai/openrouter.ts:133-140` — existing log writer proves the current app writes newline-delimited JSON events.
- `server/services/ai-chat/prompting.ts:181-230` — existing prompt shape determines `request.messages` and the user prompt JSON keys to color-coordinate.

## Verification

Run from `C:/Users/joesa/Code/localfin-ai`.

1. Script-focused typecheck:
   - Command: `npx tsc --ignoreConfig --noEmit --target ES2022 --module esnext --moduleResolution bundler --types node --skipLibCheck --strict scripts/render-log-html.ts scripts/render-log-html.test.ts`
   - Expected: no output and exit code 0.

2. New behavior tests:
   - Command: `node --import tsx --test scripts/render-log-html.test.ts`
   - Expected: all tests pass. This proves JSONL and JSON inputs parse, Markdown renders to `<strong>...</strong>`, semantic labels appear, and the HTML file is written beside the input.

3. CLI smoke test with a concrete fixture:
   - Create a temporary `log.jsonl` with exactly one line containing this JSON object:
     `{"timestamp":"2026-06-27T00:00:00.000Z","status":"success","operation":"assistant.chat","model":"test-model","requestId":"req-1","conversationId":"conv-1","request":{"messages":[{"role":"system","content":"You are LocalFin AI.\\n\\nAllowed action types:\\n- create_account: { name }\\n\\n<tools>\\nTool **definitions** here.\\n</tools>"},{"role":"user","content":"{\"currentPage\":\"/dashboard\",\"message\":\"Add **coffee** to groceries\",\"context\":{\"accounts\":[{\"name\":\"Checking\"}]},\"previousTurns\":[{\"turn\":1,\"actions\":[{\"type\":\"search_transactions\",\"status\":\"success\"}]}]}"}]},"responseText":"**Done**","actions":[{"type":"create_transaction","input":{"name":"coffee"},"status":"success"}]}`
   - Command: `npm run log:view -- <temp-dir>/log.jsonl`
   - Expected stdout: `Wrote <temp-dir>/log.html`; opening `<temp-dir>/log.html` shows one event, rendered bold Markdown for `coffee` and `Done`, colored cards labeled `System prompt`, `User request`, `Context`, and `Tools / actions`, the `create_transaction` action, plus a collapsed full JSON block.

4. Project checks:
   - Command: `npm run lint`
   - Expected: exit code 0.
   - Command: `npm run typecheck`
   - Expected: exit code 0. Note: current `tsconfig` references do not include `scripts/`, so this verifies the unchanged app/server build graph; the script-specific TypeScript command above verifies the new script files.

## Assumptions & contingencies

- The user said `log.json`, but the app currently writes `logs/*.jsonl`; implement support for both. For `.json`, accept arrays, `{ events }`, `{ entries }`, `{ messages }`, or one event object. For `.jsonl`, parse one event per line.
- The default output is “same folder, corresponding HTML” as a basename replacement, not a hard-coded `log.html` for every input. This preserves the selected preference for `log.json → log.html` and avoids overwriting when rendering multiple existing `logs/*.jsonl` files.
- No redaction is implemented; the generated HTML includes full original event JSON by design.
- If `react-markdown` cannot be rendered server-side during implementation despite the existing dependency, fallback is to implement a minimal local Markdown renderer that supports only escaped paragraphs, `**strong**`, `*emphasis*`, inline code, fenced code, headings, and lists. Do not add a new dependency unless both `react-markdown` and the local fallback fail.
