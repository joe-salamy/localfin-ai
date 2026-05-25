import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type Database from "better-sqlite3";
import {
  chatWithAssistant,
  streamChatWithAssistant,
} from "./services/ai-chat.js";
import { createAccount } from "./services/accounts.js";
import {
  createCategory,
  createSubcategory,
  getCategories,
} from "./services/categories.js";
import {
  createTransaction,
  getTransactionsWithDetails,
} from "./services/transactions.js";
import { closeDbForTests, getDb } from "./db/index.js";
import type { ChatResult } from "./services/ai-chat.js";
import type { CategoryType } from "../src/types/index.js";

type MockResponder = (
  body: Record<string, unknown>,
  callNumber: number,
) => { message: string; actions?: Array<{ type: string; input: object }> };

interface Fixture {
  db: Database.Database;
  tempDir: string;
}

const originalFetch = globalThis.fetch;
const originalDbPath = process.env.LOCALFIN_DB_PATH;
const originalApiKey = process.env.OPENROUTER_API_KEY;

function openRouterStreamResponse(content: unknown): Response {
  const text = JSON.stringify(content);
  const chunks = [
    { choices: [{ delta: { content: text } }] },
    {
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    },
  ];
  const sse = `${chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")}data: [DONE]\n\n`;

  return new Response(sse, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function installOpenRouterMock(responder: MockResponder): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    calls.push(body);
    return openRouterStreamResponse(responder(body, calls.length));
  }) as typeof fetch;
  return calls;
}

async function createFixture(t: { after: (fn: () => void | Promise<void>) => void }): Promise<Fixture> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-agent-test-"));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  const db = getDb();

  t.after(async () => {
    closeDbForTests();
    globalThis.fetch = originalFetch;
    if (originalDbPath === undefined) {
      delete process.env.LOCALFIN_DB_PATH;
    } else {
      process.env.LOCALFIN_DB_PATH = originalDbPath;
    }
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  return { db, tempDir };
}

function createNamedCategory(name: string, type: CategoryType): string {
  return createCategory({ name, type }).id;
}

function createNamedSubcategory(
  name: string,
  categoryName: string,
  monthlyGoal?: number,
): string {
  const category = getCategories().find((item) => item.name === categoryName);
  assert.ok(category, `missing category ${categoryName}`);
  return createSubcategory({
    name,
    category_id: category.id,
    monthly_goal: monthlyGoal,
  }).id;
}

async function loggedEvents(result: ChatResult): Promise<Record<string, unknown>[]> {
  assert.ok(result.logFile, "agent result should include a log file");
  const content = await readFile(result.logFile, "utf8");
  return content
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function softDeletedCounts(db: Database.Database): Record<string, number> {
  return Object.fromEntries(
    ["accounts", "categories", "subcategories", "transactions", "spending_goals"].map(
      (table) => [
        table,
        (
          db
            .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE deleted_at IS NOT NULL`)
            .get() as { count: number }
        ).count,
      ],
    ),
  );
}

test("agent creates budget structure and captures a transaction through the real tool loop", async (t) => {
  const { db } = await createFixture(t);
  const calls = installOpenRouterMock(() => ({
    message: "Created the checking account, grocery budget, and transaction.",
    actions: [
      {
        type: "create_account",
        input: { name: "Household Checking", type: "asset", initial_balance: 500 },
      },
      { type: "create_category", input: { name: "Food", type: "expense" } },
      {
        type: "create_subcategory",
        input: {
          name: "Groceries",
          category_name: "Food",
          monthly_goal: 650,
        },
      },
      {
        type: "create_transaction",
        input: {
          account_name: "Household Checking",
          date: "2026-05-24",
          name: "Whole Foods Market",
          amount: 48.23,
          kind: "expense",
          subcategory_name: "Groceries",
          comment: "weekly shop",
        },
      },
    ],
  }));

  const result = await chatWithAssistant({
    conversationId: "test-create-budget",
    message:
      "Set up Household Checking with 500, Food/Groceries at 650 monthly, and add Whole Foods 48.23 on 2026-05-24.",
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(
    result.actions.map((action) => [action.type, action.status]),
    [
      ["create_account", "success"],
      ["create_category", "success"],
      ["create_subcategory", "success"],
      ["create_transaction", "success"],
    ],
  );

  const account = db
    .prepare("SELECT name, type, initial_balance FROM accounts WHERE name = ?")
    .get("Household Checking") as
    | { name: string; type: string; initial_balance: number }
    | undefined;
  assert.deepEqual(account, {
    name: "Household Checking",
    type: "asset",
    initial_balance: 500,
  });

  const transaction = getTransactionsWithDetails({
    searchQuery: '"Whole Foods Market"',
  })[0];
  assert.equal(transaction?.amount, -48.23);
  assert.equal(transaction?.kind, "expense");
  assert.equal(transaction?.subcategory_name, "Groceries");
  assert.equal(transaction?.comment, "weekly shop");

  const events = await loggedEvents(result);
  assert.ok(events.some((event) => event.operation === "assistant.chat"));
  assert.ok(events.some((event) => event.operation === "assistant.tool_actions"));
});

test("agent searches before updating a described transaction and finishes in a follow-up turn", async (t) => {
  const { db } = await createFixture(t);
  createAccount({ name: "Test Checking", type: "asset", initial_balance: 1000 });
  createNamedCategory("Transportation", "expense");
  createNamedSubcategory("Rideshare", "Transportation", 120);
  createNamedSubcategory("Restaurants", "Transportation", 80);
  const accountId = (
    db.prepare("SELECT id FROM accounts WHERE name = ?").get("Test Checking") as {
      id: string;
    }
  ).id;
  createTransaction({
    account_id: accountId,
    date: "2026-05-01",
    name: "Uber Trip Downtown",
    amount: 21.5,
    kind: "expense",
    comment: "client pickup",
  });

  const calls = installOpenRouterMock((body, callNumber) => {
    if (callNumber === 1) {
      return {
        message: "I found matching rideshare transactions.",
        actions: [
          {
            type: "search_transactions",
            input: { searchQuery: '"Uber Trip" AND NOT Eats', limit: 10 },
          },
        ],
      };
    }

    const userMessage = JSON.parse(
      String((body.messages as Array<{ content: string }>)[1]?.content ?? "{}"),
    ) as {
      previousTurns?: Array<{
        actions: Array<{ result?: Array<{ id: string }> }>;
      }>;
    };
    const id = userMessage.previousTurns?.[0]?.actions?.[0]?.result?.[0]?.id;
    assert.ok(id, "follow-up prompt should include search results");
    return {
      message: "Updated the matching Uber trip.",
      actions: [
        {
          type: "update_transaction",
          input: {
            id,
            subcategory_name: "Rideshare",
            comment: "client rideshare",
          },
        },
      ],
    };
  });

  const result = await chatWithAssistant({
    conversationId: "test-search-update",
    message:
      'Find Uber Trip but not Eats and update it to Rideshare with comment "client rideshare".',
    maxAssistantTurns: 2,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(
    result.actions.map((action) => [action.type, action.status]),
    [
      ["search_transactions", "success"],
      ["update_transaction", "success"],
    ],
  );
  const updated = getTransactionsWithDetails({
    searchQuery: '"Uber Trip Downtown"',
  })[0];
  assert.equal(updated?.subcategory_name, "Rideshare");
  assert.equal(updated?.comment, "client rideshare");
});

test("agent persists partial failures without rolling back valid actions", async (t) => {
  const { db } = await createFixture(t);
  createAccount({ name: "Test Checking", type: "asset" });
  createNamedCategory("Food", "expense");
  createNamedSubcategory("Groceries", "Food", 500);

  installOpenRouterMock(() => ({
    message: "I added the valid item and attempted the missing account item.",
    actions: [
      {
        type: "create_transaction",
        input: {
          account_name: "Test Checking",
          date: "2026-05-24",
          name: "Corner Market",
          amount: 18.44,
          kind: "expense",
          subcategory_name: "Groceries",
        },
      },
      {
        type: "create_transaction",
        input: {
          account_name: "Missing Account",
          date: "2026-05-24",
          name: "Impossible Charge",
          amount: 9,
          kind: "expense",
          subcategory_name: "Groceries",
        },
      },
    ],
  }));

  const result = await chatWithAssistant({
    conversationId: "test-partial-failure",
    message:
      "Add Corner Market to checking and also add Impossible Charge to Missing Account.",
  });

  assert.deepEqual(
    result.actions.map((action) => [action.type, action.status]),
    [
      ["create_transaction", "success"],
      ["create_transaction", "error"],
    ],
  );
  assert.match(result.message, /1 action failed/);
  assert.equal(
    getTransactionsWithDetails({ searchQuery: '"Corner Market"' }).length,
    1,
  );
  assert.equal(
    getTransactionsWithDetails({ searchQuery: '"Impossible Charge"' }).length,
    0,
  );

  const assistantMessage = db
    .prepare(
      "SELECT status, actions_json FROM agent_messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { status: string; actions_json: string };
  assert.equal(assistantMessage.status, "partial");
  assert.match(assistantMessage.actions_json, /Missing Account/);
});

test("agent refuses deletion and streaming emits a traceable lifecycle", async (t) => {
  const { db } = await createFixture(t);
  createAccount({ name: "Test Checking", type: "asset" });
  createNamedCategory("Transportation", "expense");
  const rideshareId = createNamedSubcategory("Rideshare", "Transportation");
  const accountId = (
    db.prepare("SELECT id FROM accounts WHERE name = ?").get("Test Checking") as {
      id: string;
    }
  ).id;
  createTransaction({
    account_id: accountId,
    date: "2026-05-24",
    name: "Uber Trip Downtown",
    amount: 21.5,
    kind: "expense",
    subcategory_id: rideshareId,
  });

  installOpenRouterMock(() => ({
    message: "Deletion is not available from chat.",
    actions: [],
  }));

  const events: string[] = [];
  const result = await streamChatWithAssistant(
    {
      conversationId: "test-delete-refusal",
      message: "Delete the Uber Trip Downtown transaction.",
    },
    (event) => {
      events.push(event.type);
    },
  );

  assert.equal(result.actions.length, 0);
  assert.match(result.message, /Deletion is not available/i);
  assert.deepEqual(softDeletedCounts(db), {
    accounts: 0,
    categories: 0,
    subcategories: 0,
    transactions: 0,
    spending_goals: 0,
  });
  assert.ok(events.includes("started"));
  assert.ok(events.includes("thinking"));
  assert.ok(events.includes("response_delta"));
  assert.ok(events.includes("actions_planned"));
  assert.ok(events.includes("final"));
});
