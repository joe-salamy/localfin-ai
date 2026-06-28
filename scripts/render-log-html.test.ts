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

test("outputPathFor writes html logs under logs/html", () => {
  assert.equal(
    outputPathFor("C:/tmp/log.json"),
    path.resolve("logs", "html", "log.html"),
  );
  assert.equal(
    outputPathFor("C:/tmp/2026-01-01_chat.jsonl"),
    path.resolve("logs", "html", "2026-01-01_chat.html"),
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

test("system prompt headings consume their section content", () => {
  const event = {
    request: {
      messages: [
        {
          role: "system",
          content:
            "Intro.\n\nAmount conventions:\n- Rule one\n- Rule two\n\nAllowed action types:\n- create_account: { name }\nTransaction search supports grep-like logic in searchQuery.\nFor requests to update all/every matching transaction, prefer bulk_update_transactions.\n\nUse today's date 2026-06-28 when the user says today.",
        },
      ],
    },
  };

  const html = renderLogHtml([event], "log.jsonl");
  assert.match(html, /white-space: pre-line/);

  assert.match(
    html,
    /<section class="prompt-card prompt-rules"><h4>Rules \/ constraints<\/h4><div class="prompt-body"><p>Amount conventions:<\/p>\s*<ul>/,
  );
  assert.match(
    html,
    /<section class="prompt-card prompt-tools"><h4>Tools \/ actions<\/h4><div class="prompt-body"><p>Allowed action types:<\/p>\s*<ul>/,
  );
  assert.doesNotMatch(
    html,
    /<section class="prompt-card prompt-system"><h4>System prompt<\/h4><div class="prompt-body"><ul>/,
  );
  assert.match(html, /<h4>Rules \/ constraints<\/h4>.*Use today&#x27;s date/s);
});

test("user prompt omits null and empty context metadata", () => {
  const event = {
    request: {
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            currentPage: null,
            history: [],
            message: "Add coffee",
            context: {},
            metadata: null,
          }),
        },
      ],
    },
  };

  const html = renderLogHtml([event], "log.jsonl");

  assert.match(html, /User request/);
  assert.match(html, /Add coffee/);
  assert.doesNotMatch(html, /<h4>Metadata<\/h4>/);
  assert.doesNotMatch(html, /<h4>Context<\/h4>/);
  assert.doesNotMatch(html, /<div class="prompt-body">null<\/div>/);
  assert.doesNotMatch(html, /<pre>\[\]<\/pre>/);
  assert.doesNotMatch(html, /<pre>{}<\/pre>/);
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

test("renderLogHtmlFile writes html under logs/html", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-log-viewer-"));
  const inputPath = path.join(tempDir, `${path.basename(tempDir)}.jsonl`);
  const outputPath = outputPathFor(inputPath);
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
    await rm(outputPath, { force: true });
  });

  await writeFile(
    inputPath,
    `${JSON.stringify({ operation: "assistant.chat" })}\n`,
  );

  const renderedPath = await renderLogHtmlFile(inputPath);
  const output = await readFile(renderedPath, "utf8");

  assert.equal(renderedPath, outputPath);
  assert.equal(path.dirname(renderedPath), path.resolve("logs", "html"));
  assert.match(output, /assistant\.chat/);
});
