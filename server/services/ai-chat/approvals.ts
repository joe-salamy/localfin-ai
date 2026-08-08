import { getDb } from "../../db/index.js";
import { BadRequestError } from "../../errors.js";
import type {
  ChatActionResult,
  ChatConfirmResult,
  ChatResult,
  PlannedChatAction,
} from "../../../shared/contracts/index.js";
import { appendAgentMessage } from "../agent-conversations.js";
import { executeAction } from "./action-executor.js";
import {
  getActionReceipt,
  listActionReceipts,
  saveActionReceipt,
} from "./idempotency.js";

/** Tools that read finance data or compute but never mutate it. */
export const READ_ONLY_TOOL_NAMES = new Set(["calculate", "search_transactions"]);

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(name);
}

function actionKey(action: PlannedChatAction): string {
  return `${action.type}:${JSON.stringify(action.input ?? {})}`;
}

export function dedupeActions(
  actions: PlannedChatAction[],
): PlannedChatAction[] {
  const seen = new Set<string>();
  const result: PlannedChatAction[] = [];
  for (const action of actions) {
    const key = actionKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result;
}

interface PendingApprovalRow {
  action_type: string;
  action_input: string;
}

/**
 * Persists the mutating plan for (conversationId, requestId). Replaces any
 * previously stored plan for the same key. Deduplication happens in the tool
 * layer (which tracks live indexes for idempotency receipts), so the stored
 * order and indexes here are authoritative.
 */
export function savePendingApprovals(
  conversationId: string,
  requestId: string,
  actions: PlannedChatAction[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `DELETE FROM agent_pending_approvals
        WHERE conversation_id = ? AND request_id = ?`,
    ).run(conversationId, requestId);
    const insert = db.prepare(
      `INSERT INTO agent_pending_approvals (
         conversation_id, request_id, action_index, action_type, action_input, created_at
       ) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    );
    actions.forEach((action, index) => {
      insert.run(
        conversationId,
        requestId,
        index,
        action.type,
        JSON.stringify(action.input ?? {}),
      );
    });
  })();
}

export function loadPendingApprovals(
  conversationId: string,
  requestId: string,
): PlannedChatAction[] {
  const rows = getDb()
    .prepare(
      `SELECT action_type, action_input FROM agent_pending_approvals
        WHERE conversation_id = ? AND request_id = ?
        ORDER BY action_index ASC`,
    )
    .all(conversationId, requestId) as PendingApprovalRow[];
  return rows.map((row) => ({
    type: row.action_type,
    input: JSON.parse(row.action_input) as Record<string, unknown>,
  }));
}

export function clearPendingApprovals(
  conversationId: string,
  requestId: string,
): void {
  getDb()
    .prepare(
      `DELETE FROM agent_pending_approvals
        WHERE conversation_id = ? AND request_id = ?`,
    )
    .run(conversationId, requestId);
}

/**
 * Executes the approved plan in order, recording an idempotency receipt per
 * action. The plan rows are kept until every action has a receipt AND the
 * outcome message is persisted (both in one transaction), so a crash at any
 * point can be retried safely:
 * - crash mid-execution: plan rows remain; retry replays receipted actions
 *   and executes the rest;
 * - crash after execution: all actions replay from receipts;
 * - crash after the outcome transaction: the completed run replays as-is.
 * A stored receipt is only replayed when its type and input match the pending
 * action at the same index; otherwise the action executes fresh.
 */
export function executePendingApprovals(
  conversationId: string,
  requestId: string,
): ChatConfirmResult {
  const db = getDb();

  const completed = getCompletedRun(conversationId, requestId);
  if (completed) {
    return {
      conversationId,
      requestId,
      message: completed.message,
      actions: completed.actions,
      status: completed.status === "partial" ? "partial" : "success",
    };
  }

  const pending: PlannedChatAction[] = db
    .prepare(
      `SELECT action_type, action_input FROM agent_pending_approvals
        WHERE conversation_id = ? AND request_id = ?
        ORDER BY action_index ASC`,
    )
    .all(conversationId, requestId)
    .map((row) => ({
      type: (row as PendingApprovalRow).action_type,
      input: JSON.parse((row as PendingApprovalRow).action_input) as Record<
        string,
        unknown
      >,
    }));
  if (pending.length === 0) {
    // Plan already consumed but the outcome was never persisted: recover the
    // result from the receipts so a retry after a lost response still works.
    const receipted = listActionReceipts(conversationId, requestId);
    if (receipted.length > 0) {
      const failures = receipted.filter((action) => action.status === "error");
      const status: ChatConfirmResult["status"] =
        failures.length > 0 ? "partial" : "success";
      const message =
        failures.length === 0
          ? `Executed ${receipted.length} approved action${receipted.length === 1 ? "" : "s"}.`
          : `${failures.length} of ${receipted.length} approved action${receipted.length === 1 ? "" : "s"} failed; see the action details.`;
      const result: ChatConfirmResult = {
        conversationId,
        requestId,
        message,
        actions: receipted,
        status,
      };
      appendPlanOutcomeMessage({
        conversationId,
        requestId,
        content: result.message,
        actions: result.actions,
        status: result.status,
      });
      return result;
    }
    throw new BadRequestError(`No pending actions for request "${requestId}"`);
  }

  const actions: ChatActionResult[] = pending.map((action, index) => {
    const existing = getActionReceipt(conversationId, requestId, index);
    if (
      existing &&
      existing.type === action.type &&
      JSON.stringify(existing.input) === JSON.stringify(action.input)
    ) {
      return existing;
    }
    // Execute and record the receipt in one transaction: a crash between the
    // mutation and its receipt would otherwise re-execute on retry.
    return db.transaction((): ChatActionResult => {
      const result = executeAction(action);
      saveActionReceipt(conversationId, requestId, index, result);
      return result;
    })();
  });

  const failures = actions.filter((action) => action.status === "error");
  const status: ChatConfirmResult["status"] =
    failures.length > 0 ? "partial" : "success";
  const message =
    failures.length === 0
      ? `Executed ${actions.length} approved action${actions.length === 1 ? "" : "s"}.`
      : `${failures.length} of ${actions.length} approved action${actions.length === 1 ? "" : "s"} failed; see the action details.`;
  const result: ChatConfirmResult = {
    conversationId,
    requestId,
    message,
    actions,
    status,
  };

  db.transaction(() => {
    appendPlanOutcomeMessage({
      conversationId,
      requestId,
      content: result.message,
      actions: result.actions,
      status: result.status,
    });
    clearPendingApprovals(conversationId, requestId);
  })();

  return result;
}

interface CompletedRunRow {
  content: string;
  actions_json: string | null;
  log_file: string | null;
  status: "success" | "partial" | "error";
}

/**
 * Returns the persisted assistant completion for a request, when one exists.
 * A retry of the same requestId replays this result instead of re-running.
 */
export function getCompletedRun(
  conversationId: string,
  requestId: string,
): ChatResult | null {
  const row = getDb()
    .prepare(
      `SELECT content, actions_json, log_file, status FROM agent_messages
        WHERE conversation_id = ? AND request_id = ? AND role = 'assistant'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(conversationId, requestId) as CompletedRunRow | undefined;
  if (!row) return null;
  return {
    conversationId,
    requestId,
    message: row.content,
    actions: row.actions_json
      ? (JSON.parse(row.actions_json) as ChatActionResult[])
      : [],
    logFile: row.log_file ?? "",
    status: row.status === "error" ? "partial" : row.status,
  };
}

/** Persists the assistant message produced by an executed or rejected plan. */
export function appendPlanOutcomeMessage(input: {
  conversationId: string;
  requestId: string;
  content: string;
  actions?: ChatActionResult[];
  status: "success" | "partial";
}): void {
  appendAgentMessage({
    conversationId: input.conversationId,
    role: "assistant",
    content: input.content,
    requestId: input.requestId,
    actions: input.actions ?? null,
    status: input.status,
  });
}
