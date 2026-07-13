import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import crypto from "node:crypto";
import test from "node:test";
import type { TestContext } from "node:test";
import { callOpenRouter } from "./ai/openrouter.js";
import { ENV_KEYS, OPENROUTER_CONFIG } from "./config/app.js";
import { UpstreamServiceError } from "./errors.js";

function setOpenRouterApiKey(t: TestContext, value: string | undefined): void {
  const previous = process.env[ENV_KEYS.openRouterApiKey];
  if (value === undefined) delete process.env[ENV_KEYS.openRouterApiKey];
  else process.env[ENV_KEYS.openRouterApiKey] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[ENV_KEYS.openRouterApiKey];
    else process.env[ENV_KEYS.openRouterApiKey] = previous;
  });
}

function mockFetch(t: TestContext, implementation: typeof fetch): void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

void test("OpenRouter configuration failures remain internal errors", async (t) => {
  setOpenRouterApiKey(t, undefined);

  await assert.rejects(
    callOpenRouter([{ role: "user", content: "hello" }]),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof UpstreamServiceError) &&
      /OPENROUTER_API_KEY/.test(error.message),
  );
});

void test("OpenRouter non-2xx responses retain only redacted details", async (t) => {
  const apiKey = "audit-openrouter-api-key";
  const providerToken = "audit-provider-token";
  const conversationId = `audit-${crypto.randomUUID()}`;
  setOpenRouterApiKey(t, apiKey);
  mockFetch(
    t,
    async () =>
      new Response(
        JSON.stringify({ api_key: apiKey, access_token: providerToken }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
  );

  await assert.rejects(
    callOpenRouter([{ role: "user", content: "hello" }], {
      conversationId,
      requestId: "audit-request",
    }),
    (error: unknown) => {
      assert.ok(error instanceof UpstreamServiceError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.message, "OpenRouter request failed");
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.cause.message, new RegExp(apiKey));
      assert.doesNotMatch(error.cause.message, new RegExp(providerToken));
      return true;
    },
  );

  const fileName = (await readdir(OPENROUTER_CONFIG.logDirectory)).find((name) =>
    name.endsWith(`-${conversationId}.jsonl`),
  );
  assert.ok(fileName);
  const logPath = `${OPENROUTER_CONFIG.logDirectory}/${fileName}`;
  t.after(async () => {
    await rm(logPath, { force: true });
  });
  const log = await readFile(logPath, "utf8");
  assert.match(log, /\[REDACTED\]/);
  assert.doesNotMatch(log, new RegExp(apiKey));
  assert.doesNotMatch(log, new RegExp(providerToken));
});
