export type {
  ChatActionResult,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  PlannedChatAction,
} from "../../shared/contracts/index.js";
export type { ChatStreamEmitter } from "../../shared/contracts/parsing-ai.js";
import type {
  ChatRequest,
  ChatResult,
} from "../../shared/contracts/index.js";
import type { ChatStreamEmitter } from "../../shared/contracts/parsing-ai.js";
export { normalizeMaxAssistantTurns } from "./ai-chat/constants.js";
export { executeAction } from "./ai-chat/action-executor.js";
import {
  runAssistantChat,
  type AssistantRunOptions,
} from "./ai-chat/chat-runner.js";
export { runAssistantChat, type AssistantRunOptions } from "./ai-chat/chat-runner.js";
export {
  executePendingApprovals,
  listPendingApprovals,
  loadPendingApprovals,
  clearPendingApprovals,
  rejectPendingApprovals,
  appendPlanOutcomeMessage,
} from "./ai-chat/approvals.js";

/**
 * Serializes chat and approval work per conversation so concurrent requests
 * for the same conversation cannot interleave history or race approvals.
 */
const conversationTails = new Map<string, Promise<unknown>>();

export function serializeConversation<T>(
  conversationId: string,
  work: () => Promise<T> | T,
): Promise<T> {
  const tail = conversationTails.get(conversationId) ?? Promise.resolve();
  const result = tail.then(work, work);
  const nextTail = result.then(
    () => undefined,
    () => undefined,
  );
  conversationTails.set(conversationId, nextTail);
  void nextTail.finally(() => {
    if (conversationTails.get(conversationId) === nextTail) {
      conversationTails.delete(conversationId);
    }
  });
  return result;
}

export async function chatWithAssistant(
  request: ChatRequest,
): Promise<ChatResult> {
  return serializeConversation(request.conversationId, () =>
    runAssistantChat(request),
  );
}

export async function streamChatWithAssistant(
  request: ChatRequest,
  emit: ChatStreamEmitter,
  options?: AssistantRunOptions,
): Promise<ChatResult> {
  return serializeConversation(request.conversationId, () =>
    runAssistantChat(request, emit, options),
  );
}
