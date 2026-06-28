import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { createApp } from "./app.js";
import { closeDbForTests } from "./db/index.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const originalProviderSecret = process.env.LOCALFIN_PROVIDER_SECRET;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function useTempDatabase(t: TestContext) {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "localfin-provider-route-test-"),
  );
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  delete process.env.LOCALFIN_PROVIDER_SECRET;
  t.after(async () => {
    closeDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.LOCALFIN_DB_PATH;
    } else {
      process.env.LOCALFIN_DB_PATH = originalDbPath;
    }
    if (originalProviderSecret === undefined) {
      delete process.env.LOCALFIN_PROVIDER_SECRET;
    } else {
      process.env.LOCALFIN_PROVIDER_SECRET = originalProviderSecret;
    }
    await rm(tempDir, { recursive: true, force: true });
  });
}

async function startTestServer() {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => {
      resolve(listeningServer);
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

test("GET account-linking connections returns an empty success envelope", async (t) => {
  await useTempDatabase(t);
  const { baseUrl, server } = await startTestServer();
  t.after(() => {
    server.close();
  });

  const response = await fetch(`${baseUrl}/api/account-linking/connections`);
  const body = (await response.json()) as ApiEnvelope<unknown[]>;

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.data, []);
});

test("POST Plaid link-token validates target institution before provider env lookup", async (t) => {
  await useTempDatabase(t);
  const { baseUrl, server } = await startTestServer();
  t.after(() => {
    server.close();
  });

  const response = await fetch(
    `${baseUrl}/api/account-linking/plaid/link-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetInstitution: "fidelity" }),
    },
  );
  const body = (await response.json()) as ApiEnvelope<never>;

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error ?? "", /Invalid option|expected/i);
});
