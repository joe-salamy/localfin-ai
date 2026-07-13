import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { UpstreamServiceError } from "./errors.js";
import {
  exchangeCodeForTokens,
  refreshTokens,
} from "./services/providers/akoya-client.js";
import { createPlaidLinkToken } from "./services/providers/plaid-client.js";

const AKOYA_ENV = {
  AKOYA_CLIENT_ID: "test-client",
  AKOYA_CLIENT_SECRET: "test-secret",
  AKOYA_REDIRECT_URI: "http://127.0.0.1/callback",
} as const;

function installAkoyaEnvironment(t: TestContext): void {
  const previous = new Map(
    Object.keys(AKOYA_ENV).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, AKOYA_ENV);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function mockFetch(t: TestContext, implementation: typeof fetch): void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

void test("Plaid configuration errors remain internal configuration failures", async (t) => {
  const previousClientId = process.env.PLAID_CLIENT_ID;
  const previousSecret = process.env.PLAID_SECRET;
  delete process.env.PLAID_CLIENT_ID;
  delete process.env.PLAID_SECRET;
  t.after(() => {
    if (previousClientId === undefined) delete process.env.PLAID_CLIENT_ID;
    else process.env.PLAID_CLIENT_ID = previousClientId;
    if (previousSecret === undefined) delete process.env.PLAID_SECRET;
    else process.env.PLAID_SECRET = previousSecret;
  });

  await assert.rejects(
    createPlaidLinkToken(),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof UpstreamServiceError) &&
      /PLAID_CLIENT_ID/.test(error.message),
  );
});

void test("Akoya configuration errors remain internal configuration failures", async (t) => {
  const previous = process.env.AKOYA_CLIENT_ID;
  delete process.env.AKOYA_CLIENT_ID;
  t.after(() => {
    if (previous === undefined) delete process.env.AKOYA_CLIENT_ID;
    else process.env.AKOYA_CLIENT_ID = previous;
  });

  await assert.rejects(
    refreshTokens({ refreshToken: "refresh" }),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof UpstreamServiceError) &&
      /AKOYA_CLIENT_ID/.test(error.message),
  );
});

void test("Akoya network failures use the stable upstream error contract", async (t) => {
  installAkoyaEnvironment(t);
  const source = new Error("socket failed");
  mockFetch(t, async () => Promise.reject(source));

  await assert.rejects(
    refreshTokens({ refreshToken: "refresh" }),
    (error: unknown) =>
      error instanceof UpstreamServiceError &&
      error.statusCode === 502 &&
      error.message === "Akoya request failed" &&
      error.cause === source,
  );
});

void test("Akoya non-2xx responses redact provider tokens from the retained cause", async (t) => {
  installAkoyaEnvironment(t);
  mockFetch(
    t,
    async () =>
      new Response(JSON.stringify({ access_token: "provider-secret" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
  );

  await assert.rejects(
    exchangeCodeForTokens({ code: "code" }),
    (error: unknown) => {
      assert.ok(error instanceof UpstreamServiceError);
      assert.equal(error.message, "Akoya request failed");
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /status 401/);
      assert.match(error.cause.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.cause.message, /provider-secret/);
      return true;
    },
  );
});

void test("Akoya malformed successful responses use the stable upstream error contract", async (t) => {
  installAkoyaEnvironment(t);
  mockFetch(
    t,
    async () =>
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  await assert.rejects(
    refreshTokens({ refreshToken: "refresh" }),
    (error: unknown) =>
      error instanceof UpstreamServiceError &&
      error.message === "Akoya request failed",
  );
});
