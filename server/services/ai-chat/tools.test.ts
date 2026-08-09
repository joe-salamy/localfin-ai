import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDbForTests, getDb } from "../../db/index.js";
import { createAccount } from "../accounts.js";
import { getCategories, getSubcategories } from "../categories.js";
import { createAgentConversation } from "../agent-conversations.js";
import { createTransaction } from "../transactions.js";
import { executeFinanceAction } from "./action-executor.js";
import { saveActionReceipt } from "./idempotency.js";
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

void test("receipt mismatches do not replay another planned action", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-tool-receipt-"));
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

  const runtime = {
    actions: [],
    conversationId: "tools-receipt-test",
    requestId: "request-receipt-test",
    pendingApprovals: [],
  };
  createAgentConversation({ id: runtime.conversationId });
  saveActionReceipt(
    runtime.conversationId,
    runtime.requestId,
    0,
    {
      type: "create_account",
      input: { name: "Different", type: "asset" },
      status: "success",
      result: { id: "account-id" },
    },
  );
  const createCategoryTool = createAssistantTools(runtime).find(
    (tool) => tool.name === "create_category",
  );
  assert.ok(createCategoryTool);

  const output = await createCategoryTool.invoke({
    name: "Food",
    type: "expense",
  });
  assert.deepEqual(JSON.parse(String(output)), {
    ok: false,
    pending: true,
    message:
      "This action requires your approval and was NOT executed. Do not retry it and do not work around it; finish your turn and summarize the proposed plan for the user.",
  });
  assert.deepEqual(runtime.pendingApprovals, [
    { type: "create_category", input: { name: "Food", type: "expense" } },
  ]);
  assert.equal(runtime.actions.length, 0);
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
void test("ordered receipts replay each mutation at its own action index", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-tool-receipt-order-"));
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

  const runtime = {
    actions: [],
    conversationId: "tools-receipt-order-test",
    requestId: "request-receipt-order-test",
    pendingApprovals: [],
  };
  createAgentConversation({ id: runtime.conversationId });
  saveActionReceipt(
    runtime.conversationId,
    runtime.requestId,
    0,
    {
      type: "create_account",
      input: { name: "Checking", type: "asset" },
      status: "success",
      result: { id: "account-id" },
    },
  );
  saveActionReceipt(
    runtime.conversationId,
    runtime.requestId,
    1,
    {
      type: "create_category",
      input: { name: "Food", type: "expense" },
      status: "success",
      result: { id: "category-id" },
    },
  );

  const tools = createAssistantTools(runtime);
  const createAccountTool = tools.find((tool) => tool.name === "create_account");
  const createCategoryTool = tools.find((tool) => tool.name === "create_category");
  assert.ok(createAccountTool);
  assert.ok(createCategoryTool);

  assert.deepEqual(
    JSON.parse(
      String(
        await createAccountTool.invoke({ name: "Checking", type: "asset" }),
      ),
    ),
    { ok: true, result: { id: "account-id" } },
  );
  assert.deepEqual(
    JSON.parse(
      String(
        await createCategoryTool.invoke({ name: "Food", type: "expense" }),
      ),
    ),
    { ok: true, result: { id: "category-id" } },
  );
  assert.deepEqual(runtime.pendingApprovals, []);
});

void test("transaction updates resolve duplicate subcategory names using its existing kind", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-tool-subcategory-"));
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

  const account = createAccount({ name: "Checking", type: "asset" });
  const expenseSubcategory = getSubcategories().find((subcategory) => {
    const category = getCategories().find(
      (candidate) => candidate.id === subcategory.category_id,
    );
    return category?.type === "expense" && subcategory.name === "Unassigned";
  });
  assert.ok(expenseSubcategory);
  const transaction = createTransaction({
    account_id: account.id,
    date: "2026-08-01",
    name: "Existing expense",
    amount: -12,
    kind: "expense",
    subcategory_id: expenseSubcategory.id,
  });

  const result = executeFinanceAction({
    type: "update_transaction",
    input: {
      id: transaction.id,
      subcategory_name: "Unassigned",
      comment: "Resolved by current kind",
    },
  });

  assert.equal(result.status, "success");
  assert.equal(
    (result.result as { subcategory_id?: string }).subcategory_id,
    expenseSubcategory.id,
  );
});