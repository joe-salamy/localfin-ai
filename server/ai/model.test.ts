import assert from "node:assert/strict";
import test from "node:test";
import { AI_MODELS } from "../config/app.js";
import { createOpenRouterChatModel } from "./model.js";

const originalApiKey = process.env.OPENROUTER_API_KEY;

test.afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});

void test("requires the configured OpenRouter API key", () => {
  delete process.env.OPENROUTER_API_KEY;
  assert.throws(
    () => createOpenRouterChatModel(AI_MODELS.assistantChat),
    new Error("OPENROUTER_API_KEY not configured. Set it in .env file."),
  );

  process.env.OPENROUTER_API_KEY = "your_openrouter_api_key_here";
  assert.throws(
    () => createOpenRouterChatModel(AI_MODELS.assistantChat),
    new Error("OPENROUTER_API_KEY not configured. Set it in .env file."),
  );
});

void test("creates a deterministic model and disables parallel tools only when requested", () => {
  process.env.OPENROUTER_API_KEY = "test-key";

  const defaultModel = createOpenRouterChatModel(AI_MODELS.assistantChat);
  assert.equal(defaultModel.model, AI_MODELS.assistantChat);
  assert.equal(defaultModel.apiKey, "test-key");
  assert.equal(defaultModel.temperature, 0);
  assert.deepEqual(defaultModel.modelKwargs, undefined);

  const serialModel = createOpenRouterChatModel(AI_MODELS.assistantChat, {
    disableParallelToolCalls: true,
  });
  assert.deepEqual(serialModel.modelKwargs, { parallel_tool_calls: false });
});
