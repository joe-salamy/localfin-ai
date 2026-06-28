import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
// @ts-expect-error TS5097: node --import tsx executes this required .ts test import directly.
import {
  outputPathFor,
  parseLogText,
  renderLogHtml,
  renderLogHtmlFile,
} from "./render-log-html.ts";

test("outputPathFor replaces the input extension with html", () => {
  assert.equal(path.basename(outputPathFor("C:/tmp/log.json")), "log.html");
  assert.equal(
    path.basename(outputPathFor("C:/tmp/2026-01-01_chat.jsonl")),
    "2026-01-01_chat.html",
  );
});

test("JSON Lines render Markdown and semantic prompt sections", () => {
  const event = {
    timestamp: "2026-06-27T00:00:00.000Z",
    status: "success",
    operation: "assistant.chat",
    model: "test-model",
    requestId: "req-1",
    conversationId: "conv-1",
    request: {
      messages: [
        {
          role: "system",
          content:
            "You are LocalFin AI.\n\nAllowed action types:\n- create_account: { name }\n\n<tools>\nTool **definitions** here.\n</tools>",
        },
        {
          role: "user",
          content: JSON.stringify({
            message: "Add **coffee** to groceries",
            currentPage: "/dashboard",
            context: { accounts: [{ name: "Checking" }] },
            previousTurns: [
              {
                turn: 1,
                actions: [{ type: "search_transactions", status: "success" }],
              },
            ],
          }),
        },
      ],
    },
    responseText: "**Done**",
    actions: [{ type: "create_transaction", input: { name: "coffee" } }],
  };
  const events = parseLogText(`${JSON.stringify(event)}\n`, "log.jsonl");
  const html = renderLogHtml(events, "log.jsonl");

  assert.match(html, /Allowed action types/);
  assert.match(html, /Tools \/ actions/);
  assert.match(html, /User request/);
  assert.match(html, /Context/);
  assert.match(html, /<strong>coffee<\/strong>/);
  assert.match(html, /<strong>Done<\/strong>/);
  assert.match(html, /create_transaction/);
});

test("JSON messages shape parses one event per message object", () => {
  const events = parseLogText(
    JSON.stringify({ messages: [{ id: 1 }, { id: 2 }] }),
    "log.json",
  );

  assert.deepEqual(events, [{ id: 1 }, { id: 2 }]);
});

test("invalid JSON Lines error reports the failing line", () => {
  assert.throws(
    () => parseLogText('{"ok":true}\n{"broken"', "log.jsonl"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Invalid JSON on line 2:/);
      return true;
    },
  );
});

test("renderLogHtmlFile writes html beside the input file", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-log-viewer-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const inputPath = path.join(tempDir, "log.jsonl");
  await writeFile(
    inputPath,
    `${JSON.stringify({ operation: "assistant.chat" })}\n`,
  );

  const outputPath = await renderLogHtmlFile(inputPath);
  const output = await readFile(outputPath, "utf8");

  assert.equal(outputPath, path.join(tempDir, "log.html"));
  assert.match(output, /assistant\.chat/);
});
