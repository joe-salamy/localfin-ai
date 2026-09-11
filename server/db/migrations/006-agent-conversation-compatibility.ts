import type Database from "better-sqlite3";
import { columns } from "./helpers.js";

export function up(database: Database.Database): void {
  const conversationColumns = columns(database, "agent_conversations");
  const messageColumns = columns(database, "agent_messages");
  const value = (set: Set<string>, name: string, fallback: string): string =>
    set.has(name) ? name : fallback;
  database.exec(`
    ALTER TABLE agent_conversations RENAME TO agent_conversations_legacy;
    ALTER TABLE agent_messages RENAME TO agent_messages_legacy;
    DROP INDEX IF EXISTS idx_agent_conversations_updated;
    DROP INDEX IF EXISTS idx_agent_messages_conversation;
  `);
  database.exec(`
    CREATE TABLE agent_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      current_page TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    INSERT INTO agent_conversations (id, title, current_page, created_at, updated_at, deleted_at)
      SELECT id, COALESCE(${value(conversationColumns, "title", "NULL")}, 'New conversation'),
             ${value(conversationColumns, "current_page", "NULL")},
             COALESCE(${value(conversationColumns, "created_at", "NULL")}, datetime('now')),
             COALESCE(${value(conversationColumns, "updated_at", "NULL")}, datetime('now')), NULL
        FROM agent_conversations_legacy
       WHERE ${conversationColumns.has("deleted_at") ? "deleted_at IS NULL" : "1 = 1"};
    CREATE INDEX idx_agent_conversations_updated ON agent_conversations(updated_at DESC) WHERE deleted_at IS NULL;
    CREATE TABLE agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      request_id TEXT,
      actions_json TEXT,
      log_file TEXT,
      status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success', 'partial', 'error')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO agent_messages (id, conversation_id, role, content, request_id, actions_json, log_file, status, created_at)
      SELECT id, conversation_id,
             CASE WHEN ${value(messageColumns, "role", "'assistant'")} IN ('user', 'assistant') THEN ${value(messageColumns, "role", "'assistant'")} ELSE 'assistant' END,
             COALESCE(${value(messageColumns, "content", "NULL")}, ''),
             ${value(messageColumns, "request_id", "NULL")},
             ${value(messageColumns, "actions_json", "NULL")},
             ${value(messageColumns, "log_file", "NULL")},
             CASE WHEN ${value(messageColumns, "status", "'success'")} IN ('success', 'partial', 'error') THEN ${value(messageColumns, "status", "'success'")} ELSE 'success' END,
             COALESCE(${value(messageColumns, "created_at", "NULL")}, datetime('now'))
        FROM agent_messages_legacy
       WHERE conversation_id IN (SELECT id FROM agent_conversations)
         AND ${messageColumns.has("deleted_at") ? "deleted_at IS NULL" : "1 = 1"};
    CREATE INDEX idx_agent_messages_conversation ON agent_messages(conversation_id, created_at ASC);
    DROP TABLE agent_messages_legacy;
    DROP TABLE agent_conversations_legacy;
  `);
}
