import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import {
  appendAgentMessage,
  createAgentConversation,
  ensureAgentConversation,
  getAgentMessages,
  getRecentAgentMessagesForPrompt,
  listAgentConversations,
  softDeleteAgentConversation,
} from "./agent-conversations.js";
import { closeDbForTests, getDb } from "../db/index.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const tempRoots: string[] = [];

function restoreEnvironment(): void {
  if (originalDbPath === undefined) {
    delete process.env.LOCALFIN_DB_PATH;
  } else {
    process.env.LOCALFIN_DB_PATH = originalDbPath;
  }
}

async function useTempDb(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-agent-chat-test-"));
  tempRoots.push(tempDir);
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  getDb();
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("agent conversation schema initializes on a fresh database", async () => {
  await useTempDb();
  const db = getDb();

  const conversationColumns = db
    .prepare("PRAGMA table_info(agent_conversations)")
    .all() as Array<{ name: string }>;
  const messageColumns = db
    .prepare("PRAGMA table_info(agent_messages)")
    .all() as Array<{ name: string }>;

  assert.ok(conversationColumns.some((column) => column.name === "title"));
  assert.ok(messageColumns.some((column) => column.name === "actions_json"));
});

test("agent conversations can be created listed loaded and soft deleted", async () => {
  await useTempDb();
  const conversation = createAgentConversation({
    title: "Budget check",
    currentPage: "/",
  });
  appendAgentMessage({
    conversationId: conversation.id,
    role: "user",
    content: "How much did I spend?",
    requestId: "request-1",
  });
  appendAgentMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "You spent $42.",
    requestId: "request-1",
    actions: [
      {
        type: "search_transactions",
        input: { searchQuery: "amount>0" },
        status: "success",
        result: [],
      },
    ],
    logFile: "logs/request.jsonl",
  });

  assert.equal(listAgentConversations()[0]?.title, "Budget check");

  const messages = getAgentMessages(conversation.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[1]?.actions?.[0]?.type, "search_transactions");
  assert.equal(messages[1]?.log_file, "logs/request.jsonl");

  softDeleteAgentConversation(conversation.id);

  assert.deepEqual(listAgentConversations(), []);
  assert.throws(
    () => getAgentMessages(conversation.id),
    /Assistant conversation not found/,
  );
});

test("ensureAgentConversation creates a title from the first user message", async () => {
  await useTempDb();
  const conversation = ensureAgentConversation("conversation-1", {
    currentPage: "/transactions/history",
    firstMessage: "  Show me recent grocery spending   ",
  });

  assert.equal(conversation.id, "conversation-1");
  assert.equal(conversation.title, "Show me recent grocery spending");
  assert.equal(conversation.current_page, "/transactions/history");
});

test("recent agent messages for prompt are returned oldest to newest", async () => {
  await useTempDb();
  const conversation = createAgentConversation({ title: "History" });

  for (let index = 0; index < 10; index += 1) {
    appendAgentMessage({
      conversationId: conversation.id,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index}`,
    });
  }

  const history = getRecentAgentMessagesForPrompt(conversation.id);

  assert.equal(history.length, 8);
  assert.deepEqual(
    history.map((message) => message.content),
    [
      "message 2",
      "message 3",
      "message 4",
      "message 5",
      "message 6",
      "message 7",
      "message 8",
      "message 9",
    ],
  );
});
