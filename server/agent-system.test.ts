import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type Database from "better-sqlite3";
import {
  chatWithAssistant,
  executeAction,
  normalizeMaxAssistantTurns,
  streamChatWithAssistant,
} from "./services/ai-chat.js";
import {
  executePendingApprovals,
  loadPendingApprovals,
} from "./services/ai-chat/approvals.js";
import { saveActionReceipt } from "./services/ai-chat/idempotency.js";
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
import { createTag, getTags } from "./services/tags.js";
import { closeDbForTests, getDb } from "./db/index.js";
import { OPENROUTER_CONFIG } from "./config/app.js";
import type {
  CategoryType,
  ChatResult,
  ChatStreamEvent,
} from "../shared/contracts/index.js";
import {
  assertAllowedChatStreamEvents,
  assertOrderedChatStreamLifecycle,
  softDeletedRowCounts,
} from "./testing/agent-eval.js";

type ToolCallSpec = {
  name: string;
  args: Record<string, unknown>;
};

type MockAssistantTurn =
  | { content: string; toolCalls?: undefined }
  | { content?: string | null; toolCalls: ToolCallSpec[] };

type MockResponder = (
  body: Record<string, unknown>,
  callNumber: number,
) => MockAssistantTurn;

interface Fixture {
  db: Database.Database;
  tempDir: string;
}

const originalFetch = globalThis.fetch;
const originalDbPath = process.env.LOCALFIN_DB_PATH;
const originalApiKey = process.env.OPENROUTER_API_KEY;
let mockToolCallCounter = 0;
let mockResponseCounter = 0;

function openRouterResponse(
  turn: MockAssistantTurn,
  stream: boolean,
): Response {
  const toolCalls = turn.toolCalls?.map((call) => {
    mockToolCallCounter += 1;
    return {
      id: `call_${mockToolCallCounter}`,
      type: "function" as const,
      function: {
        name: call.name,
        arguments: JSON.stringify(call.args),
      },
    };
  });
  const responseId = `chatcmpl-test-${++mockResponseCounter}`;

  if (!stream) {
    const body =
      toolCalls && toolCalls.length > 0
        ? {
            id: responseId,
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: turn.content ?? null,
                  tool_calls: toolCalls,
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20,
            },
          }
        : {
            id: responseId,
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: turn.content ?? "",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20,
            },
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const chunks =
    toolCalls && toolCalls.length > 0
      ? [
          {
            id: responseId,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: turn.content ?? null,
                  tool_calls: toolCalls.map((call, index) => ({
                    index,
                    id: call.id,
                    type: call.type,
                    function: call.function,
                  })),
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          {
            id: responseId,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20,
            },
          },
        ]
      : [
          {
            id: responseId,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: turn.content ?? "",
                },
                finish_reason: "stop",
              },
            ],
          },
          {
            id: responseId,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20,
            },
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

function installOpenRouterMock(
  responder: MockResponder,
): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    calls.push(body);
    return openRouterResponse(responder(body, calls.length), body.stream === true);
  }) as typeof fetch;
  return calls;
}


function latestToolResult(
  body: Record<string, unknown>,
  toolName?: string,
): unknown {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    if (!("role" in message) || message.role !== "tool") continue;
    if (toolName && "name" in message && message.name !== toolName) continue;
    if (!("content" in message) || typeof message.content !== "string") {
      continue;
    }
    try {
      return JSON.parse(message.content) as unknown;
    } catch {
      return message.content;
    }
  }
  return undefined;
}

async function createFixture(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<Fixture> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-agent-test-"));
  closeDbForTests();
  mockToolCallCounter = 0;
  mockResponseCounter = 0;
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

async function loggedEvents(
  result: ChatResult,
): Promise<Record<string, unknown>[]> {
  assert.ok(result.logFile, "agent result should include a log file");
  // appendConversationLog returns the file basename; resolve against the
  // configured log directory.
  const content = await readFile(
    path.join(OPENROUTER_CONFIG.logDirectory, result.logFile),
    "utf8",
  );
  return content
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}


void test("agent creates budget structure and captures a transaction through the real tool loop", async (t) => {
  const { db } = await createFixture(t);
  const calls = installOpenRouterMock((_body, callNumber) => {
    if (callNumber === 1) {
      return {
        toolCalls: [
          {
            name: "create_account",
            args: {
              name: "Household Checking",
              type: "asset",
              initial_balance: 500,
            },
          },
          {
            name: "create_category",
            args: { name: "Food", type: "expense" },
          },
          {
            name: "create_subcategory",
            args: {
              name: "Groceries",
              category_name: "Food",
              monthly_goal: 650,
            },
          },
          {
            name: "create_transaction",
            args: {
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
      };
    }
    return {
      content:
        "Created the checking account, grocery budget, and transaction.",
    };
  });

  const result = await chatWithAssistant({
    conversationId: "test-create-budget",
    message:
      "Set up Household Checking with 500, Food/Groceries at 650 monthly, and add Whole Foods 48.23 on 2026-05-24.",
  });

  assert.equal(calls.length, 2);
  assert.equal(result.status, "awaiting_confirmation");
  assert.deepEqual(result.actions, []);
  const confirmation = executePendingApprovals(
    result.conversationId,
    result.requestId,
  );
  assert.equal(confirmation.status, "success");
  assert.deepEqual(
    confirmation.actions.map((action) => [action.type, action.status]),
    [
      ["create_account", "success"],
      ["create_category", "success"],
      ["create_subcategory", "success"],
      ["create_transaction", "success"],
    ],
  );
  assert.match(result.message, /awaiting your approval/i);

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

  assert.ok(
    events.some((event) => event.operation === "assistant.pending_approval"),
  );
});
void test(
  "agent retries a persisted pending plan without another model call",
  async (t) => {
    const { db } = await createFixture(t);
    const calls = installOpenRouterMock((_body, callNumber) =>
      callNumber === 1
        ? {
            toolCalls: [
              {
                name: "create_account",
                args: { name: "Retry Checking", type: "asset" },
              },
              {
                name: "create_category",
                args: { name: "Retry Food", type: "expense" },
              },
            ],
          }
        : { content: "The requested plan is ready for approval." },
    );
    const request = {
      conversationId: "retry-pending",
      requestId: "retry-request",
      message: "Create the retry checking account and retry food category.",
    };

    const first = await chatWithAssistant(request);
    assert.equal(first.status, "awaiting_confirmation");
    assert.deepEqual(
      loadPendingApprovals(request.conversationId, request.requestId).map(
        (action) => action.type,
      ),
      ["create_account", "create_category"],
    );

    const executed = executeAction({
      type: "create_account",
      input: { name: "Retry Checking", type: "asset" },
    });
    saveActionReceipt(
      request.conversationId,
      request.requestId,
      0,
      executed,
    );
    const callsBeforeRetry = calls.length;

    const retry = await chatWithAssistant(request);
    assert.equal(calls.length, callsBeforeRetry);
    assert.equal(retry.status, "awaiting_confirmation");
    assert.deepEqual(retry.actions, []);

    const confirmed = executePendingApprovals(
      request.conversationId,
      request.requestId,
    );
    assert.equal(confirmed.status, "success");
    assert.deepEqual(
      confirmed.actions.map((action) => [action.type, action.status]),
      [
        ["create_account", "success"],
        ["create_category", "success"],
      ],
    );
    const accountCountRow = db
      .prepare("SELECT COUNT(*) AS count FROM accounts")
      .get() as { count: number } | undefined;
    assert.equal(accountCountRow?.count, 1);
  },
);

void test("agent uses calculator results in a follow-up response", async (t) => {
  await createFixture(t);
  const calls = installOpenRouterMock((_body, callNumber) =>
    callNumber === 1
      ? {
          toolCalls: [
            {
              name: "calculate",
              args: { expression: "(12.5 * 4) + 3" },
            },
          ],
        }
      : {
          content: "The result is 53.",
        },
  );

  const result = await chatWithAssistant({
    conversationId: "test-calculator",
    message: "What is (12.5 * 4) + 3?",
  });

  assert.equal(calls.length, 2);
  assert.equal(result.message, "The result is 53.");
  assert.deepEqual(result.actions, [
    {
      type: "calculate",
      input: { expression: "(12.5 * 4) + 3" },
      status: "success",
      result: {
        expression: "(12.5 * 4) + 3",
        result: 53,
      },
    },
  ]);
});

void test("agent searches before updating a described transaction and finishes in a follow-up turn", async (t) => {
  const { db } = await createFixture(t);
  createAccount({
    name: "Test Checking",
    type: "asset",
    initial_balance: 1000,
  });
  createNamedCategory("Transportation", "expense");
  createNamedSubcategory("Rideshare", "Transportation", 120);
  createNamedSubcategory("Restaurants", "Transportation", 80);
  const accountId = (
    db
      .prepare("SELECT id FROM accounts WHERE name = ?")
      .get("Test Checking") as {
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
        toolCalls: [
          {
            name: "search_transactions",
            args: { searchQuery: '"Uber Trip" AND NOT Eats', limit: 10 },
          },
        ],
      };
    }

    if (callNumber === 2) {
      const toolResult = latestToolResult(body, "search_transactions") as {
        ok?: boolean;
        result?: Array<{ id: string }>;
      };
      const id = toolResult?.result?.[0]?.id;
      assert.ok(id, "follow-up prompt should include search results");
      return {
        toolCalls: [
          {
            name: "update_transaction",
            args: {
              id,
              subcategory_name: "Rideshare",
              comment: "client rideshare",
            },
          },
        ],
      };
    }

    return {
      content: "Updated the matching Uber trip.",
    };
  });

  const result = await chatWithAssistant({
    conversationId: "test-search-update",
    message:
      'Find Uber Trip but not Eats and update it to Rideshare with comment "client rideshare".',
    maxAssistantTurns: 5,
  });

  assert.equal(calls.length, 3);
  assert.equal(result.status, "awaiting_confirmation");
  assert.deepEqual(
    result.actions.map((action) => [action.type, action.status]),
    [["search_transactions", "success"]],
  );
  const confirmation = executePendingApprovals(
    result.conversationId,
    result.requestId,
  );
  assert.equal(confirmation.status, "success");
  assert.deepEqual(
    confirmation.actions.map((action) => [action.type, action.status]),
    [["update_transaction", "success"]],
  );
  const updated = getTransactionsWithDetails({
    searchQuery: '"Uber Trip Downtown"',
  })[0];
  assert.equal(updated?.subcategory_name, "Rideshare");
  assert.equal(updated?.comment, "client rideshare");
});

void test("agent persists partial failures without rolling back valid actions", async (t) => {
  await createFixture(t);
  createAccount({ name: "Test Checking", type: "asset" });
  createNamedCategory("Food", "expense");
  createNamedSubcategory("Groceries", "Food", 500);

  installOpenRouterMock((_body, callNumber) => {
    if (callNumber === 1) {
      return {
        toolCalls: [
          {
            name: "create_transaction",
            args: {
              account_name: "Test Checking",
              date: "2026-05-24",
              name: "Corner Market",
              amount: 18.44,
              kind: "expense",
              subcategory_name: "Groceries",
            },
          },
          {
            name: "create_transaction",
            args: {
              account_name: "Missing Account",
              date: "2026-05-24",
              name: "Impossible Charge",
              amount: 9,
              kind: "expense",
              subcategory_name: "Groceries",
            },
          },
        ],
      };
    }
    return {
      content: "I added the valid item and attempted the missing account item.",
    };
  });

  const result = await chatWithAssistant({
    conversationId: "test-partial-failure",
    message:
      "Add Corner Market to checking and also add Impossible Charge to Missing Account.",
  });

  assert.equal(result.status, "awaiting_confirmation");
  assert.deepEqual(result.actions, []);
  assert.match(result.message, /awaiting your approval/i);
  const confirmation = executePendingApprovals(
    result.conversationId,
    result.requestId,
  );
  assert.equal(confirmation.status, "partial");
  assert.deepEqual(
    confirmation.actions.map((action) => [action.type, action.status]),
    [
      ["create_transaction", "success"],
      ["create_transaction", "error"],
    ],
  );
  assert.equal(
    getTransactionsWithDetails({ searchQuery: '"Corner Market"' }).length,
    1,
  );
  assert.equal(
    getTransactionsWithDetails({ searchQuery: '"Impossible Charge"' }).length,
    0,
  );
});

void test("agent refuses deletion and streaming emits a traceable lifecycle", async (t) => {
  const { db } = await createFixture(t);
  createAccount({ name: "Test Checking", type: "asset" });
  createNamedCategory("Transportation", "expense");
  const rideshareId = createNamedSubcategory("Rideshare", "Transportation");
  const accountId = (
    db
      .prepare("SELECT id FROM accounts WHERE name = ?")
      .get("Test Checking") as {
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
    content: "Deletion is not available from chat.",
  }));

  const events: ChatStreamEvent[] = [];
  const result = await streamChatWithAssistant(
    {
      conversationId: "test-delete-refusal",
      message: "Delete the Uber Trip Downtown transaction.",
    },
    (event) => {
      events.push(event);
    },
  );

  assert.equal(result.actions.length, 0);
  assert.match(result.message, /Deletion is not available/i);
  assert.deepEqual(softDeletedRowCounts(db), {
    accounts: 0,
    categories: 0,
    subcategories: 0,
    transactions: 0,
    goals: 0,
  });
  assert.ok(events.some((event) => event.type === "started"));
  assert.equal(
    events.some((event) =>
      ["reasoning_delta", "reasoning_details", "response_delta"].includes(
        event.type,
      ),
    ),
    false,
  );
  assert.ok(events.some((event) => event.type === "final"));
  assert.equal(assertAllowedChatStreamEvents(events).status, "pass");
  assert.equal(assertOrderedChatStreamLifecycle(events).status, "pass");
});

void test("agent creates an explicit trip tag and assigns it to a transaction", async (t) => {
  const { db } = await createFixture(t);
  createAccount({
    name: "Travel Checking",
    type: "asset",
    initial_balance: 2000,
  });
  createNamedCategory("Travel", "expense");
  createNamedSubcategory("Lodging", "Travel");
  const calls = installOpenRouterMock((_body, callNumber) => {
    if (callNumber === 1) {
      return {
        toolCalls: [
          {
            name: "create_transaction",
            args: {
              account_name: "Travel Checking",
              date: "2026-06-15",
              name: "Cabo Hotel",
              amount: 420,
              kind: "expense",
              subcategory_name: "Lodging",
              tags: [{ name: "Cabo Trip", type: "trip" }],
            },
          },
        ],
      };
    }
    return {
      content: "Added the hotel transaction and tagged it for the Cabo trip.",
    };
  });

  const events: ChatStreamEvent[] = [];
  const result = await streamChatWithAssistant(
    {
      conversationId: "test-explicit-trip-tag",
      message:
        "Add a 420 hotel charge on 2026-06-15 from Travel Checking and tag it as Cabo Trip.",
    },
    (event) => {
      events.push(event);
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(result.status, "awaiting_confirmation");
  assert.ok(events.some((event) => event.type === "actions_planned"));
  assert.ok(
    events.some((event) => event.type === "confirmation_requested"),
  );
  assert.equal(
    events.some((event) =>
      ["action_started", "action_finished"].includes(event.type),
    ),
    false,
  );
  assert.equal(
    events.some((event) =>
      ["reasoning_delta", "reasoning_details", "response_delta"].includes(
        event.type,
      ),
    ),
    false,
  );
  assert.ok(events.some((event) => event.type === "final"));
  assert.equal(assertOrderedChatStreamLifecycle(events).status, "pass");
  assert.deepEqual(result.actions, []);
  const confirmation = executePendingApprovals(
    result.conversationId,
    result.requestId,
  );
  assert.equal(confirmation.status, "success");
  assert.deepEqual(
    getTags().map((tag) => ({ name: tag.name, type: tag.type })),
    [{ name: "Cabo Trip", type: "trip" }],
  );
  const transaction = getTransactionsWithDetails({
    searchQuery: '"Cabo Hotel"',
  })[0];
  assert.ok(transaction, "expected tagged transaction");
  assert.deepEqual(
    transaction.tags.map((tag) => ({ name: tag.name, type: tag.type })),
    [{ name: "Cabo Trip", type: "trip" }],
  );
  const searchAction = executeAction({
    type: "search_transactions",
    input: { searchQuery: '"Cabo Hotel"' },
  });
  const searchResults = searchAction.result;
  assert.ok(Array.isArray(searchResults), "expected search result array");
  assert.deepEqual(searchResults[0]?.tags, [
    { id: transaction.tags[0]?.id, name: "Cabo Trip", type: "trip" },
  ]);
  const tagRow = db
    .prepare("SELECT name, type FROM tags WHERE name = ?")
    .get("Cabo Trip");
  assert.deepEqual(tagRow, { name: "Cabo Trip", type: "trip" });
  createTransaction({
    account_id: transaction.account_id,
    date: "2026-06-16",
    name: "Cabo Hotel Untagged",
    amount: 210,
    kind: "expense",
    subcategory_id: transaction.subcategory_id,
  });
  const tagFilteredSearch = executeAction({
    type: "search_transactions",
    input: { searchQuery: '"Cabo Hotel"', tag_ids: [transaction.tags[0]?.id] },
  });
  const tagFilteredResults = tagFilteredSearch.result;
  assert.ok(
    Array.isArray(tagFilteredResults),
    "expected tag-filtered search results",
  );
  assert.deepEqual(
    tagFilteredResults.map((item: { id: string }) => item.id),
    [transaction.id],
  );
});

void test("agent update failure does not create explicit add-tag side effects", async (t) => {
  await createFixture(t);

  const result = executeAction({
    type: "update_transaction",
    input: {
      id: "missing-transaction",
      add_tag_names: ["Cabo Trip"],
    },
  });

  assert.equal(result.status, "error");
  assert.match(
    result.error ?? "",
    /Transaction with id "missing-transaction" not found/,
  );
  assert.deepEqual(getTags(), []);
});

void test("agent rejects conflicting bulk tag edits when also updating comments", async (t) => {
  await createFixture(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const categoryId = createNamedCategory("Travel", "expense");
  const subcategory = createSubcategory({
    name: "Hotels",
    category_id: categoryId,
  });
  const tag = createTag({ name: "Cabo Trip", type: "trip" });
  const transaction = createTransaction({
    account_id: account.id,
    date: "2026-06-15",
    name: "Cabo Hotel",
    amount: 420,
    kind: "expense",
    subcategory_id: subcategory.id,
    tag_ids: [tag.id],
  });

  const result = executeAction({
    type: "bulk_update_transactions",
    input: {
      searchQuery: '"Cabo Hotel"',
      updates: {
        comment: "client trip",
        add_tag_ids: [tag.id],
        remove_tag_ids: [tag.id],
      },
    },
  });

  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /Cannot add and remove the same tag/);
  const unchanged = getTransactionsWithDetails({
    searchQuery: '"Cabo Hotel"',
  })[0];
  assert.equal(unchanged?.id, transaction.id);
  assert.equal(unchanged?.comment, null);
  assert.deepEqual(
    unchanged?.tags.map((item) => item.id),
    [tag.id],
  );
});

void test("agent validates category references and normalizes transaction comments", async (t) => {
  await createFixture(t);
  const account = createAccount({ name: "Checking", type: "asset" });
  const categoryId = createNamedCategory("Food", "expense");
  const subcategory = createSubcategory({
    name: "Coffee",
    category_id: categoryId,
  });

  const invalidUpdate = executeAction({
    type: "update_subcategory",
    input: {
      id: subcategory.id,
      category_name: "Missing category",
      name: "Coffee shops",
    },
  });
  assert.equal(invalidUpdate.status, "error");
  assert.match(invalidUpdate.error ?? "", /unknown category/);

  const created = executeAction({
    type: "create_transaction",
    input: {
      account_id: account.id,
      date: "2026-06-15",
      name: "Coffee",
      amount: -6,
      kind: "expense",
      subcategory_id: subcategory.id,
      comment: "  client coffee  ",
    },
  });
  assert.equal(created.status, "success");
  const transaction = getTransactionsWithDetails({
    searchQuery: '"Coffee"',
  })[0];
  assert.ok(transaction, "expected created transaction");
  assert.equal(transaction.comment, "client coffee");

  const blankUpdate = executeAction({
    type: "update_transaction",
    input: { id: transaction.id, comment: "   " },
  });
  assert.equal(blankUpdate.status, "success");
  assert.equal(
    getTransactionsWithDetails({ searchQuery: '"Coffee"' })[0]?.comment,
    "client coffee",
  );
});

void test("agent does not infer tags without explicit tag wording", async (t) => {
  await createFixture(t);
  createAccount({
    name: "Travel Checking",
    type: "asset",
    initial_balance: 2000,
  });
  createNamedCategory("Travel", "expense");
  createNamedSubcategory("Lodging", "Travel");
  const calls = installOpenRouterMock((_body, callNumber) => {
    if (callNumber === 1) {
      return {
        toolCalls: [
          {
            name: "create_transaction",
            args: {
              account_name: "Travel Checking",
              date: "2026-06-15",
              name: "Hotel in Cabo",
              amount: 420,
              kind: "expense",
              subcategory_name: "Lodging",
            },
          },
        ],
      };
    }
    return {
      content: "Added the Cabo hotel transaction.",
    };
  });

  const result = await chatWithAssistant({
    conversationId: "test-no-inferred-tags",
    message:
      "Add a 420 hotel in Cabo on 2026-06-15 from Travel Checking under Lodging.",
  });

  assert.equal(calls.length, 2);
  assert.equal(result.status, "awaiting_confirmation");
  assert.deepEqual(result.actions, []);
  const confirmation = executePendingApprovals(
    result.conversationId,
    result.requestId,
  );
  assert.equal(confirmation.status, "success");
  assert.equal(getTags().length, 0);
  const transaction = getTransactionsWithDetails({
    searchQuery: '"Hotel in Cabo"',
  })[0];
  assert.ok(transaction, "expected untagged transaction");
  assert.deepEqual(transaction.tags, []);

  const firstCall = calls[0];
  assert.ok(firstCall, "expected OpenRouter call");
  assert.ok(Array.isArray(firstCall.messages), "expected prompt messages");
  const systemMessage = firstCall.messages.find((message) => {
    if (!message || typeof message !== "object") return false;
    if (!("role" in message)) return false;
    return message.role === "system";
  });
  assert.ok(systemMessage, "expected system prompt");
  let systemText = "";
  if ("content" in systemMessage) {
    if (typeof systemMessage.content === "string") {
      systemText = systemMessage.content;
    } else if (Array.isArray(systemMessage.content)) {
      systemText = systemMessage.content
        .map((part: unknown) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            return typeof part.text === "string" ? part.text : "";
          }
          return "";
        })
        .join("");
    }
  }
  assert.match(systemText, /Tags are explicit-only/);
  assert.match(systemText, /Do not infer tags from merchants/i);
  assert.ok(Array.isArray(firstCall.tools), "expected native tool schemas");
  assert.ok(
    (firstCall.tools as unknown[]).length > 0,
    "expected at least one tool",
  );
});

void test("normalizeMaxAssistantTurns defaults, truncates, and clamps values", () => {
  assert.equal(normalizeMaxAssistantTurns(undefined), 5);
  assert.equal(normalizeMaxAssistantTurns("not a number"), 5);
  assert.equal(normalizeMaxAssistantTurns(0), 1);
  assert.equal(normalizeMaxAssistantTurns(2.9), 2);
  assert.equal(normalizeMaxAssistantTurns(99), 10);
});
