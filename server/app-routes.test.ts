import assert from "node:assert/strict";
import test from "node:test";
import { expectEnvelope, useApp } from "./tests/helpers.js";

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

void test("JSON parser failures use safe operational envelopes", async (t) => {
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
});


