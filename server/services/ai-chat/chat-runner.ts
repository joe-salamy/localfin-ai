import crypto from "node:crypto";
import { appendConversationLog } from "../../ai/openrouter.js";
import { getSubcategories } from "../categories.js";
import {
  appendAgentMessage,
  ensureAgentConversation,
  getRecentAgentMessagesForPrompt,
  touchAgentConversationPage,
} from "../agent-conversations.js";
import type {
  ChatRequest,
  ChatResult,
  ChatStreamEmitter,
  ExecutedAction,
  ToolLoopState,
} from "./types.js";
import { normalizeMaxAssistantTurns } from "./constants.js";
import {
  buildSearchUpdateFollowUp,
  prepareActionsForExecution,
} from "./action-preparation.js";
import { executeAction } from "./action-executor.js";
import {
  planAssistantActions,
  planningContext,
  removePreviouslySuccessfulActions,
} from "./prompting.js";

export function actionCompletesMutation(action: ExecutedAction): boolean {
  return (
    action.status === "success" &&
    (action.type === "bulk_update_transactions" ||
      /^(create|update)_/.test(action.type))
  );
}

export function actionCompletesCreate(action: ExecutedAction): boolean {
  return action.status === "success" && /^create_/.test(action.type);
}

export function actionFailureCanBeRetried(action: ExecutedAction): boolean {
  if (action.status !== "error" || !action.error) return false;
  return (
    /\breferences (?:an unknown|ambiguous) (?:account|category|subcategory|tag)\b/i.test(
      action.error,
    ) ||
    /\b(?:Account|Category|Subcategory|Tag) with id ".+" not found\b/i.test(
      action.error,
    ) ||
    /\brequires id or (?:existing account name|current_name|subcategory)\b/i.test(
      action.error,
    )
  );
}

export function messageRequestsMutationAfterSearch(message: string): boolean {
  return (
    /\b(update|change|set|move|classify|categorize)\b/i.test(message) &&
    !/\bdo not\s+(?:update|change|set|move|classify|categorize)\b/i.test(
      message,
    )
  );
}

export function shouldContinueToolLoop(
  message: string,
  turnActions: ExecutedAction[],
): boolean {
  const shouldContinueAfterSearch =
    messageRequestsMutationAfterSearch(message) &&
    turnActions.some(
      (action) =>
        action.type === "search_transactions" && action.status === "success",
    ) &&
    !turnActions.some(actionCompletesMutation);
  const shouldRepairFailure =
    turnActions.some(actionFailureCanBeRetried) &&
    !turnActions.some(actionCompletesCreate);

  return shouldContinueAfterSearch || shouldRepairFailure;
}

export async function runAssistantChat(
  request: ChatRequest,
  emit?: ChatStreamEmitter,
): Promise<ChatResult> {
  const requestId = crypto.randomUUID();
  const maxTurns = normalizeMaxAssistantTurns(request.maxAssistantTurns);
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

  const actions: ExecutedAction[] = [];
  const previousTurns: ToolLoopState[] = [];
  let finalAssistantMessage = "Done.";
  let logFile = "";

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const { parsed, logFile: turnLogFile } = await planAssistantActions(
      request,
      requestId,
      turn,
      conversationHistory,
      previousTurns,
      emit,
    );
    logFile = turnLogFile;
    finalAssistantMessage = parsed.message;

    const plannedActions = removePreviouslySuccessfulActions(
      prepareActionsForExecution(
        parsed.actions ?? [],
        request.message,
        parsed.message,
        planningContext(),
        previousTurns,
      ),
      previousTurns,
    );
    await emit?.({ type: "actions_planned", actions: plannedActions });

    const turnActions: ExecutedAction[] = [];
    for (let index = 0; index < plannedActions.length; index += 1) {
      const action = plannedActions[index];
      if (!action) continue;
      const actionIndex = actions.length;
      await emit?.({ type: "action_started", index: actionIndex, action });
      const executedAction = executeAction(action);
      actions.push(executedAction);
      turnActions.push(executedAction);
      await emit?.({
        type: "action_finished",
        index: actionIndex,
        action: executedAction,
      });

      if (action.type === "search_transactions" && turn === maxTurns) {
        const followUp = buildSearchUpdateFollowUp(
          plannedActions,
          request.message,
          { action, executedAction },
          getSubcategories(),
        );
        if (followUp) {
          plannedActions.splice(index + 1, 0, followUp);
        }
      }
    }

    previousTurns.push({
      turn,
      assistantMessage: parsed.message,
      actions: turnActions,
    });

    if (plannedActions.length === 0) break;
    if (!shouldContinueToolLoop(request.message, turnActions)) break;
  }

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
  const suffix =
    actionErrors.length > 0
      ? ` ${actionErrors.length} action${actionErrors.length === 1 ? "" : "s"} failed; see the action details.`
      : "";

  const result = {
    conversationId: request.conversationId,
    requestId,
    message: `${finalAssistantMessage}${suffix}`,
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
