import assert from "node:assert/strict";
import { rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AI_MODELS } from "./config/app.js";
import { closeDbForTests, getDb } from "./db/index.js";
import { categorizeTransactions } from "./services/ai.js";
import { createAccount } from "./services/accounts.js";
import { createCategory, createSubcategory } from "./services/categories.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const originalApiKey = process.env.OPENROUTER_API_KEY;
const originalFetch = globalThis.fetch;

async function useCategorizationFixture(
  t: { after: (fn: () => void | Promise<void>) => void },
): Promise<{ accountId: string; subcategoryId: string }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-ai-categorization-"));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  const account = createAccount({ name: "Checking", type: "asset" });
  const category = createCategory({ name: "Food", type: "expense" });
  const subcategory = createSubcategory({
    name: "Groceries",
    category_id: category.id,
  });
  getDb();

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

  return { accountId: account.id, subcategoryId: subcategory.id };
}

void test("categorizes ordered batches through the structured tool contract", async (t) => {
  const { accountId, subcategoryId } = await useCategorizationFixture(t);
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    return new Response(
      JSON.stringify({
        id: "categorization-test",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_categorize",
                  type: "function",
                  function: {
                    name: "categorize_transactions",
                    arguments: JSON.stringify({
                      results: [
                        { kind: "expense", subcategory_id: subcategoryId },
                        { kind: "transfer", subcategory_id: null },
                      ],
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const results = await categorizeTransactions({
    conversationId: "categorization-test-request",
    transactions: [
      {
        name: "Coffee Shop",
        account_id: accountId,
        account_name: "Checking",
        account_type: "asset",
        amount: -12,
        date: "2026-08-01",
      },
      {
        name: "Move to savings",
        account_id: accountId,
        account_name: "Checking",
        account_type: "asset",
        amount: -100,
        date: "2026-08-02",
      },
    ],
  });

  assert.deepEqual(
    results.map((result) => ({
      transaction_name: result.transaction_name,
      kind: result.kind,
      subcategory_id: result.subcategory_id,
      source: result.source,
    })),
    [
      {
        transaction_name: "Coffee Shop",
        kind: "expense",
        subcategory_id: subcategoryId,
        source: "ai",
      },
      {
        transaction_name: "Move to savings",
        kind: "transfer",
        subcategory_id: null,
        source: "ai",
      },
    ],
  );

  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.equal(request.model, AI_MODELS.transactionCategorization);
  assert.equal(request.temperature, 0);
  assert.deepEqual(request.tool_choice, {
    type: "function",
    function: { name: "categorize_transactions" },
  });
  const tools = request.tools as Array<{
    function?: { name?: string; parameters?: unknown };
  }>;
  assert.equal(tools[0]?.function?.name, "categorize_transactions");
  const requestText = JSON.stringify(request);
  assert.doesNotMatch(requestText, /numeric_choice|transaction_index|raw_response/i);
  assert.match(requestText, /Groceries/);
});
