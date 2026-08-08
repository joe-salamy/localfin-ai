import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import express from "express";
import { z } from "zod";
import { createApp, errorHandler } from "./app.js";
import { closeDbForTests } from "./db/index.js";
import { UpstreamServiceError } from "./errors.js";

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
type Envelope = z.infer<typeof envelopeSchema>;

async function listen(app: express.Express): Promise<{ baseUrl: string; server: Server }> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP port");
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

async function useApp(t: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "localfin-app-routes-"));
  const previousPath = process.env.LOCALFIN_DB_PATH;
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(directory, "budget.db");
  const { baseUrl, server } = await listen(createApp());
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    closeDbForTests();
    if (previousPath === undefined) delete process.env.LOCALFIN_DB_PATH;
    else process.env.LOCALFIN_DB_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  return baseUrl;
}

async function envelope(response: Response): Promise<Envelope> {
  return envelopeSchema.parse(await response.json());
}

void test("real app preserves success envelopes and maps validation, conflicts, and missing routes", async (t) => {
  const baseUrl = await useApp(t);
  const created = await fetch(`${baseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Checking", type: "asset" }),
  });
  assert.equal(created.status, 201);
  assert.equal((await envelope(created)).success, true);

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
  assert.match((await envelope(conflict)).error ?? "", /already exists/);

  const missing = await fetch(`${baseUrl}/api/accounts/missing`);
  assert.equal(missing.status, 404);
  assert.equal((await envelope(missing)).error, "Account not found");

  const unmatched = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(unmatched.status, 404);
  assert.deepEqual(await envelope(unmatched), {
    success: false,
    error: "Route not found",
  });
});

void test("JSON parser failures and CORS rejection use safe operational envelopes", async (t) => {
  const baseUrl = await useApp(t);
  const malformed = await fetch(`${baseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await envelope(malformed)).error, "Invalid JSON body");

  const oversized = await fetch(`${baseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x".repeat(2_000_000), type: "asset" }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await envelope(oversized)).error, "Request body too large");

  const cors = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://not-allowed.example" },
  });
  assert.equal(cors.status, 403);
  assert.equal((await envelope(cors)).error, "Origin not allowed by CORS");
});

void test("chat confirm executes approved plans, rejects discard, and replays retries", async (t) => {
  const baseUrl = await useApp(t);
  const { createAgentConversation } = await import(
    "./services/agent-conversations.js"
  );
  const { savePendingApprovals } = await import(
    "./services/ai-chat/approvals.js"
  );
  createAgentConversation({ id: "confirm-conv" });
  const jsonPost = (body: unknown) =>
    fetch(`${baseUrl}/api/ai/chat/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const missing = await jsonPost({
    conversationId: "confirm-conv",
    requestId: "req-missing",
    approve: true,
  });
  assert.equal(missing.status, 400);

  savePendingApprovals("confirm-conv", "req-approve", [
    { type: "create_account", input: { name: "Approved Checking", type: "asset" } },
  ]);
  const approved = await jsonPost({
    conversationId: "confirm-conv",
    requestId: "req-approve",
    approve: true,
  });
  assert.equal(approved.status, 200);
  const approvedBody = (await envelope(approved)) as Envelope & {
    data: { message: string; actions: Array<{ status: string; type: string }> };
  };
  assert.equal(approvedBody.data.actions.length, 1);
  assert.equal(approvedBody.data.actions[0].status, "success");
  assert.equal(approvedBody.data.actions[0].type, "create_account");

  const accounts = await (await fetch(`${baseUrl}/api/accounts`)).json() as {
    data: Array<{ name: string }>;
  };
  assert.ok(
    accounts.data.some((account) => account.name === "Approved Checking"),
    "approved plan must have created the account",
  );

  const messages = await (await fetch(
    `${baseUrl}/api/ai/conversations/confirm-conv/messages`,
  )).json() as {
    data: Array<{ role: string; request_id: string; content: string }>;
  };
  assert.ok(
    messages.data.some(
      (message) =>
        message.role === "assistant" && message.request_id === "req-approve",
    ),
    "approved plan outcome must be persisted as an assistant message",
  );

  const replay = await jsonPost({
    conversationId: "confirm-conv",
    requestId: "req-approve",
    approve: true,
  });
  assert.equal(replay.status, 200, "a retried confirm replays the completed run");
  const replayBody = (await envelope(replay)) as Envelope & {
    data: { message: string; actions: Array<{ status: string }> };
  };
  assert.equal(replayBody.data.message, approvedBody.data.message);
  assert.equal(replayBody.data.actions.length, 1);

  // Crash-window recovery: plan rows still present, all actions receipted.
  savePendingApprovals("confirm-conv", "req-crash", [
    { type: "create_account", input: { name: "Crash Checking", type: "asset" } },
    { type: "create_category", input: { name: "Crash Category", type: "expense" } },
  ]);
  const firstCrashRun = await jsonPost({
    conversationId: "confirm-conv",
    requestId: "req-crash",
    approve: true,
  });
  assert.equal(firstCrashRun.status, 200);
  // Re-create the plan rows as if the process crashed before cleanup.
  savePendingApprovals("confirm-conv", "req-crash", [
    { type: "create_account", input: { name: "Crash Checking", type: "asset" } },
    { type: "create_category", input: { name: "Crash Category", type: "expense" } },
  ]);
  const retriedCrashRun = await jsonPost({
    conversationId: "confirm-conv",
    requestId: "req-crash",
    approve: true,
  });
  assert.equal(retriedCrashRun.status, 200);
  const retriedCrashBody = (await envelope(retriedCrashRun)) as Envelope & {
    data: { actions: Array<{ status: string }> };
  };
  assert.equal(
    retriedCrashBody.data.actions.length,
    2,
    "retry must replay both receipted actions",
  );
  assert.ok(
    retriedCrashBody.data.actions.every((action) => action.status === "success"),
  );
  const accountsAfterCrash = await (await fetch(`${baseUrl}/api/accounts`)).json() as {
    data: Array<{ name: string }>;
  };
  assert.equal(
    accountsAfterCrash.data.filter((account) => account.name === "Crash Checking")
      .length,
    1,
    "crash-window retry must not duplicate executed actions",
  );

  savePendingApprovals("confirm-conv", "req-reject", [
    { type: "create_category", input: { name: "Rejected Category", type: "expense" } },
  ]);
  const rejected = await jsonPost({
    conversationId: "confirm-conv",
    requestId: "req-reject",
    approve: false,
  });
  assert.equal(rejected.status, 200);
  const rejectedBody = await envelope(rejected);
  assert.equal(
    (rejectedBody.data as { actions: unknown[] }).actions.length,
    0,
  );
  const categories = await (await fetch(`${baseUrl}/api/categories`)).json() as {
    data: Array<{ name: string }>;
  };
  assert.ok(
    !categories.data.some((category) => category.name === "Rejected Category"),
    "rejected plan must not mutate anything",
  );
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
    const unknownBody = await envelope(unknown);
    assert.equal(unknownBody.error, "Internal server error");
    assert.doesNotMatch(JSON.stringify(unknownBody), /secret detail/);

    const upstream = await fetch(`${baseUrl}/upstream`);
    assert.equal(upstream.status, 502);
    const upstreamBody = await envelope(upstream);
    assert.equal(upstreamBody.error, "Plaid request failed");
    assert.doesNotMatch(JSON.stringify(upstreamBody), /provider body/);
  } finally {
    console.error = originalError;
  }
});
