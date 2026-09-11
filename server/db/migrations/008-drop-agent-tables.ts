import type Database from "better-sqlite3";

export function up(database: Database.Database): void {
  database.exec(`
    DROP TABLE IF EXISTS agent_pending_approvals;
    DROP TABLE IF EXISTS agent_action_receipts;
    DROP TABLE IF EXISTS pending_approvals;
    DROP TABLE IF EXISTS action_receipts;
    DROP TABLE IF EXISTS agent_messages;
    DROP TABLE IF EXISTS agent_conversations;
  `);
}
