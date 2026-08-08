import { getDb } from "../../db/index.js";
import type { ChatActionResult } from "../../../shared/contracts/index.js";

interface ReceiptRow {
  action_type: string;
  action_input: string;
  result_status: "success" | "error";
  result_json: string | null;
  result_error: string | null;
}

function rowToResult(row: ReceiptRow): ChatActionResult {
  return {
    type: row.action_type,
    input: JSON.parse(row.action_input) as Record<string, unknown>,
    status: row.result_status,
    ...(row.result_json !== null
      ? { result: JSON.parse(row.result_json) as unknown }
      : {}),
    ...(row.result_error !== null ? { error: row.result_error } : {}),
  };
}

/**
 * Returns the stored result for a previously executed action, or null when the
 * action was not executed under this (conversationId, requestId, index) key.
 */
export function getActionReceipt(
  conversationId: string,
  requestId: string,
  actionIndex: number,
): ChatActionResult | null {
  const row = getDb()
    .prepare(
      `SELECT action_type, action_input, result_status, result_json, result_error
         FROM agent_action_receipts
        WHERE conversation_id = ? AND request_id = ? AND action_index = ?`,
    )
    .get(conversationId, requestId, actionIndex) as ReceiptRow | undefined;
  return row ? rowToResult(row) : null;
}

/**
 * Records that an action executed successfully under this idempotency key so a
 * retry of the same request replays the stored result instead of mutating again.
 */
export function saveActionReceipt(
  conversationId: string,
  requestId: string,
  actionIndex: number,
  result: ChatActionResult,
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO agent_action_receipts (
         conversation_id, request_id, action_index, action_type, action_input,
         result_status, result_json, result_error, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      conversationId,
      requestId,
      actionIndex,
      result.type,
      JSON.stringify(result.input),
      result.status,
      result.result !== undefined ? JSON.stringify(result.result) : null,
      result.error ?? null,
    );
}

/** True when any action of this request has already executed. */
export function hasActionReceipts(
  conversationId: string,
  requestId: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM agent_action_receipts
        WHERE conversation_id = ? AND request_id = ? LIMIT 1`,
    )
    .get(conversationId, requestId) as { "1": number } | undefined;
  return row !== undefined;
}

/** All receipts for a request in execution order. */
export function listActionReceipts(
  conversationId: string,
  requestId: string,
): ChatActionResult[] {
  const rows = getDb()
    .prepare(
      `SELECT action_type, action_input, result_status, result_json, result_error
         FROM agent_action_receipts
        WHERE conversation_id = ? AND request_id = ?
        ORDER BY action_index ASC`,
    )
    .all(conversationId, requestId) as ReceiptRow[];
  return rows.map(rowToResult);
}
