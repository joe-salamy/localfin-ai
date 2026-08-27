import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import type { Express } from "express";
import { createApp } from "../app.js";
import { closeDbForTests } from "../db/index.js";

async function listen(app: Express): Promise<{ baseUrl: string; server: Server }> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP port");
  return { baseUrl: `http://127.0.0.1:${(address as { port: number }).port}`, server };
}

async function useApp(t: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "localfin-openapi-"));
  const previousPath = process.env.LOCALFIN_DB_PATH;
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(directory, "budget.db");
  const { baseUrl, server } = await listen(createApp());
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    closeDbForTests();
    if (previousPath === undefined) delete process.env.LOCALFIN_DB_PATH;
    else process.env.LOCALFIN_DB_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  return baseUrl;
}

void test("GET /api/openapi.json returns openapi spec with expected paths", async (t) => {
  const baseUrl = await useApp(t);
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
  const baseUrl = await useApp(t);
  const response = await fetch(`${baseUrl}/api/openapi`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.openapi, "3.0.3");
});
