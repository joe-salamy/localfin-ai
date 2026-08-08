import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDbForTests, getDb } from "../../db/index.js";
import { createAssistantTools } from "./tools.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;

void test("native tool schemas reject invalid scalar, enum, date, and unknown fields before execution", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-tool-schema-"));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  getDb();
  t.after(async () => {
    closeDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.LOCALFIN_DB_PATH;
    } else {
      process.env.LOCALFIN_DB_PATH = originalDbPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  const events: unknown[] = [];
  const runtime = {
    actions: [],
    conversationId: "tools-schema-test",
    requestId: "request-schema-test",
    pendingApprovals: [],
    emit: (event: unknown) => {
      events.push(event);
    },
  };
  const tools = createAssistantTools(runtime);
  const createAccountTool = tools.find((tool) => tool.name === "create_account");
  const createTransactionTool = tools.find(
    (tool) => tool.name === "create_transaction",
  );
  assert.ok(createAccountTool);
  assert.ok(createTransactionTool);

  await assert.rejects(() =>
    createAccountTool.invoke({
      name: "Checking",
      type: "not-an-account-type",
      unexpected: true,
    }),
  );
  await assert.rejects(() =>
    createTransactionTool.invoke({
      account_name: "Checking",
      date: "2026-02-31",
      name: "Invalid date",
      amount: Number.NaN,
    }),
  );
  assert.equal(runtime.actions.length, 0);
  assert.equal(events.length, 0);
});

void test("mutating tools buffer plans and deduplicate retries without executing", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-tool-pending-"));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  getDb();
  t.after(async () => {
    closeDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.LOCALFIN_DB_PATH;
    } else {
      process.env.LOCALFIN_DB_PATH = originalDbPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  const events: unknown[] = [];
  const runtime = {
    actions: [],
    conversationId: "tools-pending-test",
    requestId: "request-pending-test",
    pendingApprovals: [],
    emit: (event: unknown) => {
      events.push(event);
    },
  };
  const createAccountTool = createAssistantTools(runtime).find(
    (tool) => tool.name === "create_account",
  );
  assert.ok(createAccountTool);

  const input = { name: "Savings", type: "asset" as const };
  const firstOutput = await createAccountTool.invoke(input);
  const secondOutput = await createAccountTool.invoke(input);
  const expected = {
    ok: false,
    pending: true,
    message:
      "This action requires your approval and was NOT executed. Do not retry it and do not work around it; finish your turn and summarize the proposed plan for the user.",
  };
  assert.deepEqual(JSON.parse(String(firstOutput)), expected);
  assert.deepEqual(JSON.parse(String(secondOutput)), expected);
  assert.deepEqual(runtime.pendingApprovals, [
    { type: "create_account", input },
  ]);
  assert.equal(runtime.actions.length, 0);
  assert.equal(events.length, 0);
});

void test("valid native tool input reaches the typed executor and lifecycle adapter", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-tool-valid-"));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  getDb();
  t.after(async () => {
    closeDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.LOCALFIN_DB_PATH;
    } else {
      process.env.LOCALFIN_DB_PATH = originalDbPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  const events: Array<{ type: string }> = [];
  const runtime = {
    actions: [],
    conversationId: "tools-readonly-test",
    requestId: "request-readonly-test",
    pendingApprovals: [],
    emit: (event: { type: string }) => {
      events.push(event);
    },
  };
  const calculateTool = createAssistantTools(runtime).find(
    (tool) => tool.name === "calculate",
  );
  assert.ok(calculateTool);

  const output = await calculateTool.invoke({ expression: "(2 * 3) + 1" });
  assert.deepEqual(JSON.parse(String(output)), {
    ok: true,
    result: {
      expression: "(2 * 3) + 1",
      result: 7,
    },
  });
  assert.deepEqual(runtime.actions, [
    {
      type: "calculate",
      input: { expression: "(2 * 3) + 1" },
      status: "success",
      result: { expression: "(2 * 3) + 1", result: 7 },
    },
  ]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["action_started", "action_finished"],
  );
});
