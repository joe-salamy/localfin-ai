import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";
import express from "express";
import { errorHandler } from "./app.js";
import { UpstreamServiceError } from "./errors.js";
import { expectEnvelope, useApp } from "./tests/helpers.js";

async function listen(app: express.Express): Promise<{ baseUrl: string; server: Server }> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP port");
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

void test("real app preserves success envelopes and maps validation, conflicts, and missing routes", async (t) => {
  const baseUrl = await useApp(t, "localfin-app-routes-");
  const created = await fetch(`${baseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Checking", type: "asset" }),
  });
  assert.equal(created.status, 201);
  assert.equal((await expectEnvelope(created)).success, true);

  const invalid = await fetch(`${baseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "" }),
  });
  assert.equal(invalid.status, 400);

  const conflict = await fetch(`${baseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Checking", type: "asset" }),
  });
  assert.equal(conflict.status, 409);
  assert.match((await expectEnvelope(conflict)).error ?? "", /already exists/);

  const missing = await fetch(`${baseUrl}/api/accounts/missing`);
  assert.equal(missing.status, 404);
  assert.equal((await expectEnvelope(missing)).error, "Account not found");

  const unmatched = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(unmatched.status, 404);
  assert.deepEqual(await expectEnvelope(unmatched), {
    success: false,
    error: "Route not found",
  });
});

void test("JSON parser failures and CORS rejection use safe operational envelopes", async (t) => {
  const baseUrl = await useApp(t, "localfin-app-routes-");
  const malformed = await fetch(`${baseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await expectEnvelope(malformed)).error, "Invalid JSON body");

  const oversized = await fetch(`${baseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x".repeat(2_000_000), type: "asset" }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await expectEnvelope(oversized)).error, "Request body too large");

  const cors = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://not-allowed.example" },
  });
  assert.equal(cors.status, 403);
  assert.equal((await expectEnvelope(cors)).error, "Origin not allowed by CORS");
});


void test("central handler hides unknown failures and exposes only stable upstream literals", async (t) => {
  const app = express();
  app.get("/unknown", () => {
    throw new Error("database secret detail");
  });
  app.get("/upstream", () => {
    throw new UpstreamServiceError("Plaid request failed", {
      cause: new Error("provider body secret"),
    });
  });
  app.use(errorHandler);
  const { baseUrl, server } = await listen(app);
  t.after(() => server.close());

  const originalError = console.error;
  console.error = () => undefined;
  try {
    const unknown = await fetch(`${baseUrl}/unknown`);
    assert.equal(unknown.status, 500);
    const unknownBody = await expectEnvelope(unknown);
    assert.equal(unknownBody.error, "Internal server error");
    assert.doesNotMatch(JSON.stringify(unknownBody), /secret detail/);

    const upstream = await fetch(`${baseUrl}/upstream`);
    assert.equal(upstream.status, 502);
    const upstreamBody = await expectEnvelope(upstream);
    assert.equal(upstreamBody.error, "Plaid request failed");
    assert.doesNotMatch(JSON.stringify(upstreamBody), /provider body/);
  } finally {
    console.error = originalError;
  }
});
