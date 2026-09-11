import assert from "node:assert/strict";
import test from "node:test";
import { useApp } from "../tests/helpers.js";

void test("GET /api/openapi.json returns openapi spec with expected paths", async (t) => {
  const baseUrl = await useApp(t, "localfin-openapi-");
  const response = await fetch(`${baseUrl}/api/openapi.json`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.openapi, "3.0.3");
  const paths = body.paths as Record<string, unknown> | undefined;
  assert.ok(paths, "expected paths");
  assert.ok(paths["/api/transactions"], "expected /api/transactions in spec");
  const txPath = paths["/api/transactions"] as Record<string, unknown>;
  assert.ok(txPath.get, "expected GET /api/transactions");
  assert.ok(paths["/api/accounts"], "expected /api/accounts in spec");
  const accountsPath = paths["/api/accounts"] as Record<string, unknown>;
  assert.ok(accountsPath.post, "expected POST /api/accounts");
});

void test("GET /api/openapi also serves spec", async (t) => {
  const baseUrl = await useApp(t, "localfin-openapi-");
  const response = await fetch(`${baseUrl}/api/openapi`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.openapi, "3.0.3");
});
