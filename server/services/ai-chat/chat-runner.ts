import crypto from "node:crypto";
import { createAgent } from "langchain";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
} from "@langchain/core/messages";
import type { OpenRouterReasoningDetail } from "../../ai/openrouter.js";
import { appendConversationLog } from "../../ai/openrouter.js";
import {
  appendAgentMessage,
  ensureAgentConversation,
  getRecentAgentMessagesForPrompt,
  touchAgentConversationPage,
} from "../agent-conversations.js";
import type {
  AIAction,
  ChatRequest,
  ChatResult,
  ChatStreamEmitter,
  ExecutedAction,
} from "./types.js";
import { normalizeMaxAssistantTurns } from "./constants.js";
import { assistantSystemMessage, buildUserPrompt } from "./prompting.js";
import { createAssistantChatModel } from "./model.js";
import { createAssistantTools } from "./tools.js";

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

function isAssistantMessage(
  message: unknown,
): message is AIMessage | AIMessageChunk {
  return message instanceof AIMessage || message instanceof AIMessageChunk;
}

function plannedActions(message: AIMessage | AIMessageChunk): AIAction[] {
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

function reasoningText(message: AIMessage | AIMessageChunk): string {
  const additionalKwargs = message.additional_kwargs;
  if (!additionalKwargs || typeof additionalKwargs !== "object") return "";
  const reasoning = additionalKwargs.reasoning;
  return typeof reasoning === "string" ? reasoning : "";
}

function reasoningDetails(
  message: AIMessage | AIMessageChunk,
): OpenRouterReasoningDetail[] {
  const additionalKwargs = message.additional_kwargs;
  if (
    !additionalKwargs ||
    typeof additionalKwargs !== "object" ||
    !("reasoning_details" in additionalKwargs)
  ) {
    return [];
  }
  const details = additionalKwargs.reasoning_details;
  if (!Array.isArray(details)) return [];
  return details.filter(
    (detail): detail is OpenRouterReasoningDetail =>
      detail !== null && typeof detail === "object",
  );
}

function finalAssistantText(
  messages: unknown[],
  actions: ExecutedAction[],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantMessage(message)) continue;
    const text = messageText(message.content).trim();
    if (text) return text;
  }
  if (actions.length === 0) return "Done.";
  if (actions.every((action) => action.status === "success")) return "Done.";
  return "Finished with some action errors.";
}

export async function runAssistantChat(
  request: ChatRequest,
  emit?: ChatStreamEmitter,
): Promise<ChatResult> {
  const requestId = crypto.randomUUID();
  const maxTurns = normalizeMaxAssistantTurns(request.maxAssistantTurns);
  // Each tool round uses a model step and a tools step; the final answer needs one model step.
  const recursionLimit = Math.max(3, maxTurns * 2 + 1);

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
  appendAgentMessage({
    conversationId: request.conversationId,
    role: "user",
    content: request.message,
    requestId,
  });

  await emit?.({
    type: "thinking",
    message: "Reading your finance context and planning actions...",
  });

  const runtime = {
    actions: [] as ExecutedAction[],
    emit,
  };
  const agent = createAgent({
    model: createAssistantChatModel(),
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
  const outputMessages: unknown[] = [...inputMessages];

  try {
    const stream = await agent.stream(
      { messages: inputMessages },
      {
        recursionLimit,
        streamMode: ["messages", "updates"],
      },
    );

    for await (const event of stream) {
      if (!Array.isArray(event) || event.length < 2) continue;
      const mode = event[0];
      const payload = event[1];

      if (mode === "messages" && Array.isArray(payload)) {
        const message = payload[0];
        const metadata = payload[1];
        const nodeName =
          metadata && typeof metadata === "object" && "langgraph_node" in metadata
            ? metadata.langgraph_node
            : undefined;
        if (nodeName !== "model_request" || !isAssistantMessage(message)) {
          continue;
        }

        const text = messageText(message.content);
        if (text) {
          await emit?.({ type: "response_delta", content: text });
        }
        const reasoning = reasoningText(message);
        if (reasoning) {
          await emit?.({ type: "reasoning_delta", message: reasoning });
        }
        const details = reasoningDetails(message);
        if (details.length > 0) {
          await emit?.({ type: "reasoning_details", details });
        }
        continue;
      }

      if (mode !== "updates" || !payload || typeof payload !== "object") {
        continue;
      }

      for (const [nodeName, nodeUpdate] of Object.entries(
        payload as Record<string, unknown>,
      )) {
        if (!nodeUpdate || typeof nodeUpdate !== "object") continue;
        if (!("messages" in nodeUpdate)) continue;
        const messages = nodeUpdate.messages;
        if (!Array.isArray(messages)) continue;
        outputMessages.push(...messages);

        if (nodeName !== "model_request") continue;
        for (const message of messages) {
          if (!isAssistantMessage(message)) continue;
          const actions = plannedActions(message);
          if (actions.length > 0) {
            await emit?.({ type: "actions_planned", actions });
          }
        }
      }
    }
  } finally {
    logFile = await appendConversationLog(request.conversationId, {
      timestamp: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: runtime.actions.some((action) => action.status === "error")
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
  const baseMessage = finalAssistantText(outputMessages, actions);
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

export async function chatWithAssistant(
  request: ChatRequest,
): Promise<ChatResult> {
  return runAssistantChat(request);
}

export async function streamChatWithAssistant(
  request: ChatRequest,
  emit: ChatStreamEmitter,
): Promise<ChatResult> {
  return runAssistantChat(request, emit);
}
