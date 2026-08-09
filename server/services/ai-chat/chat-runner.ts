import crypto from "node:crypto";
import { createAgent } from "langchain";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { appendConversationLog } from "../../ai/conversation-log.js";
import { AI_MODELS } from "../../config/app.js";
import {
  appendAgentMessage,
  ensureAgentConversation,
  getRecentAgentMessagesForPrompt,
  touchAgentConversationPage,
} from "../agent-conversations.js";
import type {
  ChatActionResult,
  ChatRequest,
  ChatResult,
  PlannedChatAction,
} from "../../../shared/contracts/index.js";
import type { ChatStreamEmitter } from "../../../shared/contracts/parsing-ai.js";
import { normalizeMaxAssistantTurns } from "./constants.js";
import { assistantSystemMessage, buildUserPrompt } from "./prompting.js";
import { createOpenRouterChatModel } from "../../ai/model.js";
import { createAssistantTools } from "./tools.js";
import {
  getCompletedRun,
  loadPendingApprovals,
  savePendingApprovals,
} from "./approvals.js";
import { hasActionReceipts } from "./idempotency.js";

export interface AssistantRunOptions {
  signal?: AbortSignal;
}

/** Hard ceiling for non-streamed runs that have no client signal to cancel. */
const RUN_TIMEOUT_MS = 120_000;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = part.text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

function isAssistantMessage(message: unknown): message is AIMessage {
  return message instanceof AIMessage;
}

function plannedActions(message: AIMessage): PlannedChatAction[] {
  return (message.tool_calls ?? [])
    .filter((call) => typeof call.name === "string" && call.name.length > 0)
    .map((call) => ({
      type: call.name,
      input:
        call.args && typeof call.args === "object"
          ? (call.args as Record<string, unknown>)
          : {},
    }));
}

function finalAssistantText(
  messages: AIMessage[],
  actions: ChatActionResult[],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messageText(messages[index].content).trim();
    if (text) return text;
  }
  if (actions.length === 0) return "Done.";
  if (actions.every((action) => action.status === "success")) return "Done.";
  return "Finished with some action errors.";
}

function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

export async function runAssistantChat(
  request: ChatRequest,
  emit?: ChatStreamEmitter,
  options: AssistantRunOptions = {},
): Promise<ChatResult> {
  const requestId = request.requestId ?? crypto.randomUUID();
  const maxTurns = normalizeMaxAssistantTurns(request.maxAssistantTurns);
  const recursionLimit = Math.max(3, maxTurns * 2 + 1);
  const timeoutSignal = AbortSignal.timeout(RUN_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  // Idempotent replay: when this exact request already completed (and its
  // approved plan was executed), replay the stored result without re-running
  // the model or mutating anything again.
  const completed = getCompletedRun(request.conversationId, requestId);
  if (completed) {
    await emit?.({
      type: "started",
      conversationId: request.conversationId,
      requestId,
    });
    await emit?.({ type: "final", data: completed });
    return completed;
  }
  const persistedPending = loadPendingApprovals(
    request.conversationId,
    requestId,
  );
  if (persistedPending.length > 0) {
    const pendingResult: ChatResult = {
      conversationId: request.conversationId,
      requestId,
      message: `${persistedPending.length} proposed action${persistedPending.length === 1 ? " is" : "s are"} awaiting your approval.`,
      actions: [],
      logFile: "",
      status: "awaiting_confirmation",
    };
    await emit?.({
      type: "started",
      conversationId: request.conversationId,
      requestId,
    });
    await emit?.({
      type: "confirmation_requested",
      requestId,
      actions: persistedPending,
    });
    await emit?.({ type: "final", data: pendingResult });
    return pendingResult;
  }


  await emit?.({
    type: "started",
    conversationId: request.conversationId,
    requestId,
  });

  ensureAgentConversation(request.conversationId, {
    currentPage: request.currentPage ?? null,
    firstMessage: request.message,
  });
  touchAgentConversationPage(
    request.conversationId,
    request.currentPage ?? null,
  );
  const conversationHistory = getRecentAgentMessagesForPrompt(
    request.conversationId,
  );
  // A retry of a request that partially executed must not duplicate the user
  // message; executed actions are replayed from receipts by the tools.
  if (!hasActionReceipts(request.conversationId, requestId)) {
    appendAgentMessage({
      conversationId: request.conversationId,
      role: "user",
      content: request.message,
      requestId,
    });
  }

  await emit?.({
    type: "thinking",
    message: "Reading your finance context and planning actions...",
  });

  const runtime = {
    actions: [] as ChatActionResult[],
    emit,
    conversationId: request.conversationId,
    requestId,
    signal,
    pendingApprovals: [] as PlannedChatAction[],
  };
  const agent = createAgent({
    model: createOpenRouterChatModel(AI_MODELS.assistantChat, {
      disableParallelToolCalls: true,
    }),
    tools: createAssistantTools(runtime),
    systemPrompt: assistantSystemMessage(),
  });

  const historyMessages = conversationHistory.map((entry) =>
    entry.role === "assistant"
      ? new AIMessage(entry.content)
      : new HumanMessage(entry.content),
  );
  const inputMessages = [
    ...historyMessages,
    new HumanMessage(
      buildUserPrompt({
        message: request.message,
        currentPage: request.currentPage,
      }),
    ),
  ];

  const startedAt = new Date();
  let logFile = "";
  const assistantMessages: AIMessage[] = [];

  try {
    const stream = await agent.stream(
      { messages: inputMessages },
      {
        recursionLimit,
        streamMode: "updates",
        ...(signal ? { signal } : {}),
      },
    );

    for await (const update of stream) {
      if (signal?.aborted) throw abortError();
      if (!update || typeof update !== "object" || Array.isArray(update)) {
        continue;
      }

      for (const [nodeName, nodeUpdate] of Object.entries(
        update as Record<string, unknown>,
      )) {
        if (!nodeUpdate || typeof nodeUpdate !== "object") continue;
        if (!("messages" in nodeUpdate)) continue;
        const messages = nodeUpdate.messages;
        if (!Array.isArray(messages)) continue;

        if (nodeName !== "model_request") continue;
        for (const message of messages) {
          if (!isAssistantMessage(message)) continue;
          assistantMessages.push(message);
          const actions = plannedActions(message);
          if (actions.length > 0) {
            await emit?.({ type: "actions_planned", actions });
          }
        }
      }
    }
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw abortError();
    }
    throw error;
  } finally {
    logFile = await appendConversationLog(request.conversationId, {
      timestamp: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: runtime.pendingApprovals.length > 0
        ? "awaiting_approval"
        : runtime.actions.some((action) => action.status === "error")
          ? "partial"
          : "success",
      operation: "assistant.chat",
      conversationId: request.conversationId,
      requestId,
      metadata: {
        currentPage: request.currentPage ?? null,
        maxAssistantTurns: maxTurns,
        recursionLimit,
      },
    });
  }

  if (signal?.aborted) throw abortError();

  const pending = runtime.pendingApprovals;
  if (pending.length > 0) {
    savePendingApprovals(request.conversationId, requestId, pending);
    await appendConversationLog(request.conversationId, {
      timestamp: new Date().toISOString(),
      status: "awaiting_approval",
      operation: "assistant.pending_approval",
      conversationId: request.conversationId,
      requestId,
      actions: pending,
    });

    const result: ChatResult = {
      conversationId: request.conversationId,
      requestId,
      message: `${pending.length} proposed action${pending.length === 1 ? " is" : "s are"} awaiting your approval.`,
      actions: runtime.actions,
      logFile,
      status: "awaiting_confirmation",
    };
    await emit?.({ type: "confirmation_requested", requestId, actions: pending });
    await emit?.({ type: "final", data: result });
    return result;
  }

  const actions = runtime.actions;
  await appendConversationLog(request.conversationId, {
    timestamp: new Date().toISOString(),
    status: actions.some((action) => action.status === "error")
      ? "partial"
      : "success",
    operation: "assistant.tool_actions",
    conversationId: request.conversationId,
    requestId,
    actions,
  });

  const actionErrors = actions.filter((action) => action.status === "error");
  const status = actionErrors.length > 0 ? "partial" : "success";
  const baseMessage = finalAssistantText(assistantMessages, actions);
  const suffix =
    actionErrors.length > 0
      ? ` ${actionErrors.length} action${actionErrors.length === 1 ? "" : "s"} failed; see the action details.`
      : "";

  const result: ChatResult = {
    conversationId: request.conversationId,
    requestId,
    message: `${baseMessage}${suffix}`,
    actions,
    logFile,
    status,
  };

  appendAgentMessage({
    conversationId: request.conversationId,
    role: "assistant",
    content: result.message,
    requestId,
    actions,
    logFile,
    status,
  });

  await emit?.({ type: "final", data: result });
  return result;
}
