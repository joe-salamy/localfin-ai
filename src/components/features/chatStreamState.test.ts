import { expect, test } from "vitest";
import type {
  AgentMessage,
  ChatActionResult,
  ChatStreamEvent,
  ChatResult,
} from "@shared/contracts";
import {
  chatUiReducer,
  initialChatUiState,
  messageFromPersisted,
} from "./chatStreamState";

const plannedAction = {
  type: "calculate",
  input: { expression: "1 + 1" },
};

const completedAction: ChatActionResult = {
  ...plannedAction,
  status: "success",
  result: { result: 2 },
};

const result: ChatResult = {
  conversationId: "conversation-1",
  requestId: "request-1",
  message: "The result is 2.",
  actions: [completedAction],
  logFile: "",
  status: "success",
};

function reduceEvents(events: ChatStreamEvent[]) {
  return events.reduce(chatUiReducer, initialChatUiState());
}

test("loads persisted messages and resets a conversation", () => {
  const persisted: AgentMessage = {
    id: "message-1",
    conversation_id: "conversation-1",
    role: "assistant",
    content: "Saved answer",
    request_id: "request-0",
    actions: null,
    log_file: null,
    status: "success",
    created_at: "2026-08-07T00:00:00.000Z",
  };
  const loaded = messageFromPersisted(persisted);
  const state = chatUiReducer(
    chatUiReducer(initialChatUiState(), {
      type: "request_started",
    }),
    { type: "messages_loaded", messages: [loaded] },
  );

  expect(state).toEqual({ messages: [loaded], stream: null });
  expect(chatUiReducer(state, { type: "conversation_reset" })).toEqual(
    initialChatUiState(),
  );
});

test("retains the ordered lifecycle and replaces actions immutably", () => {
  let state = chatUiReducer(initialChatUiState(), {
    type: "user_message",
    message: { id: "user-1", role: "user", content: "Calculate 1 + 1" },
  });
  state = chatUiReducer(state, { type: "request_started" });
  state = chatUiReducer(state, {
    type: "started",
    conversationId: "conversation-1",
    requestId: "request-1",
  });
  state = chatUiReducer(state, {
    type: "thinking",
    message: "Planning...",
  });
  state = chatUiReducer(state, {
    type: "actions_planned",
    actions: [plannedAction],
  });
  const plannedState = state;
  state = chatUiReducer(state, {
    type: "action_started",
    index: 0,
    action: plannedAction,
  });
  expect(state.stream).not.toBe(plannedState.stream);
  expect(state.stream?.actions).toHaveLength(1);
  expect(state.stream?.actions[0]).toMatchObject({
    ...plannedAction,
    status: "pending",
  });

  const runningState = state;
  state = chatUiReducer(state, {
    type: "action_finished",
    index: 0,
    action: completedAction,
  });
  expect(state.stream).not.toBe(runningState.stream);
  expect(state.stream?.actions[0]).toEqual(completedAction);
  expect(state.stream?.status).toBe("Tool call finished.");

  state = chatUiReducer(state, { type: "final", data: result });
  expect(state.stream).toBeNull();
  expect(state.messages).toEqual([
    { id: "user-1", role: "user", content: "Calculate 1 + 1" },
    {
      id: "request-1",
      role: "assistant",
      content: "The result is 2.",
      actions: [completedAction],
    },
  ]);
});

test("server and transport errors insert messages and clear in-flight state", () => {
  const started = reduceEvents([
    {
      type: "started",
      conversationId: "conversation-1",
      requestId: "request-1",
    },
  ]);
  const serverError = chatUiReducer(started, {
    type: "error",
    message: "The assistant failed.",
  });
  expect(serverError).toEqual({
    messages: [
      {
        id: "request-1",
        role: "assistant",
        content: "The assistant failed.",
      },
    ],
    stream: null,
  });

  const transportError = chatUiReducer(
    chatUiReducer(initialChatUiState(), { type: "request_started" }),
    {
      type: "transport_error",
      id: "transport-error-1",
      message: "Connection lost.",
    },
  );
  expect(transportError).toEqual({
    messages: [
      {
        id: "transport-error-1",
        role: "assistant",
        content: "Connection lost.",
      },
    ],
    stream: null,
  });
});
