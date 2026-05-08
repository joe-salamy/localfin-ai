import assert from "node:assert/strict";
import test from "node:test";
import { chatSchema } from "./ai.js";

test("chat route schema defaults optional max assistant turns", () => {
  const result = chatSchema.parse({
    conversationId: "conversation-1",
    message: "hello",
  });

  assert.equal(result.maxAssistantTurns, undefined);
});

test("chat route schema clamps max assistant turns", () => {
  assert.equal(
    chatSchema.parse({
      conversationId: "conversation-1",
      message: "hello",
      maxAssistantTurns: 0,
    }).maxAssistantTurns,
    1,
  );
  assert.equal(
    chatSchema.parse({
      conversationId: "conversation-1",
      message: "hello",
      maxAssistantTurns: 99,
    }).maxAssistantTurns,
    10,
  );
});
