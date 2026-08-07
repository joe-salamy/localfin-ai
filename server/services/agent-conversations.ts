import crypto from "node:crypto";
import type {
  AgentConversation,
  AgentMessage,
  ChatActionResult,
} from "../../shared/contracts/index.js";
export type { AgentConversation, AgentMessage } from "../../shared/contracts/index.js";
import { getDb } from "../db/index.js";
import { NotFoundError } from "../errors.js";

interface AgentMessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  request_id: string | null;
  actions_json: string | null;
  log_file: string | null;
  status: "success" | "partial" | "error";
  created_at: string;
}

interface CreateConversationInput {
  id?: string;
  title?: string;
  currentPage?: string | null;
}

interface AppendMessageInput {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  requestId?: string | null;
  actions?: ChatActionResult[] | null;
  logFile?: string | null;
  status?: "success" | "partial" | "error";
}

const DEFAULT_TITLE = "New conversation";
const TITLE_MAX_LENGTH = 80;
const HISTORY_LIMIT = 8;

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromMessage(message: string): string {
  const title = message.replace(/\s+/g, " ").trim();
  if (!title) return DEFAULT_TITLE;
  return title.length > TITLE_MAX_LENGTH
    ? `${title.slice(0, TITLE_MAX_LENGTH - 1)}...`
    : title;
}

function parseActions(value: string | null): ChatActionResult[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatActionResult[]) : null;
  } catch {
    return null;
  }
}

function rowToMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    request_id: row.request_id,
    actions: parseActions(row.actions_json),
    log_file: row.log_file,
    status: row.status,
    created_at: row.created_at,
  };
}

export function createAgentConversation(
  input: CreateConversationInput = {},
): AgentConversation {
  const db = getDb();
  const id = input.id ?? crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO agent_conversations (id, title, current_page, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(id, input.title ?? DEFAULT_TITLE, input.currentPage ?? null, now, now);

  return db
    .prepare("SELECT * FROM agent_conversations WHERE id = ?")
    .get(id) as AgentConversation;
}

export function ensureAgentConversation(
  id: string,
  options: { currentPage?: string | null; firstMessage?: string } = {},
): AgentConversation {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM agent_conversations WHERE id = ?")
    .get(id) as AgentConversation | undefined;

  if (existing) {
    if (existing.deleted_at) {
      throw new NotFoundError("Assistant conversation was deleted.")
    }
    return existing;
  }

  return createAgentConversation({
    id,
    title: options.firstMessage
      ? titleFromMessage(options.firstMessage)
      : DEFAULT_TITLE,
    currentPage: options.currentPage,
  });
}

export function listAgentConversations(): AgentConversation[] {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT *
        FROM agent_conversations
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC, created_at DESC
      `,
    )
    .all() as AgentConversation[];
}

export function getAgentConversation(id: string): AgentConversation | null {
  const db = getDb();
  const conversation = db
    .prepare(
      `
        SELECT *
        FROM agent_conversations
        WHERE id = ? AND deleted_at IS NULL
      `,
    )
    .get(id) as AgentConversation | undefined;
  return conversation ?? null;
}

export function getAgentMessages(conversationId: string): AgentMessage[] {
  const db = getDb();
  const conversation = getAgentConversation(conversationId);
  if (!conversation) {
    throw new NotFoundError("Assistant conversation not found.")
  }

  const rows = db
    .prepare(
      `
        SELECT *
        FROM agent_messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC, rowid ASC
      `,
    )
    .all(conversationId) as AgentMessageRow[];
  return rows.map(rowToMessage);
}

export function getRecentAgentMessagesForPrompt(
  conversationId: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT role, content
        FROM agent_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      `,
    )
    .all(conversationId, HISTORY_LIMIT) as Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  return rows.reverse();
}

export function appendAgentMessage(input: AppendMessageInput): AgentMessage {
  const db = getDb();
  ensureAgentConversation(input.conversationId);

  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO agent_messages (
        id,
        conversation_id,
        role,
        content,
        request_id,
        actions_json,
        log_file,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    input.conversationId,
    input.role,
    input.content,
    input.requestId ?? null,
    input.actions ? JSON.stringify(input.actions) : null,
    input.logFile ?? null,
    input.status ?? "success",
    now,
  );

  db.prepare(
    `
      UPDATE agent_conversations
      SET updated_at = ?
      WHERE id = ?
    `,
  ).run(now, input.conversationId);

  const row = db
    .prepare("SELECT * FROM agent_messages WHERE id = ?")
    .get(id) as AgentMessageRow;
  return rowToMessage(row);
}

export function touchAgentConversationPage(
  conversationId: string,
  currentPage?: string | null,
): void {
  if (currentPage === undefined) return;
  const db = getDb();
  db.prepare(
    `
      UPDATE agent_conversations
      SET current_page = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `,
  ).run(currentPage, nowIso(), conversationId);
}

export function softDeleteAgentConversation(id: string): void {
  const db = getDb();
  const now = nowIso();
  const result = db
    .prepare(
      `
        UPDATE agent_conversations
        SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `,
    )
    .run(now, now, id);

  if (result.changes === 0) {
    throw new NotFoundError("Assistant conversation not found.")
  }
}
