import crypto from "node:crypto";
import type { Tag, TagType } from "../../src/types/index.js";
import { getDb } from "../db/index.js";

interface TagRow {
  id: string;
  name: string;
  type: string;
  color: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

interface TransactionTagRow extends TagRow {
  transaction_id: string;
}

const DEFAULT_TAG_TYPE: TagType = "custom";

function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeTagType(type: TagType | undefined): TagType {
  return type ?? DEFAULT_TAG_TYPE;
}

function rowToTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    type: row.type as TagType,
    color: row.color,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function requireNormalizedName(name: string): string {
  const normalized = normalizeTagName(name);
  if (!normalized) {
    throw new Error("Tag name is required");
  }
  return normalized;
}

function findActiveTagByNameAndType(
  name: string,
  type: TagType,
): TagRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT *
       FROM tags
       WHERE lower(trim(name)) = lower(trim(?))
         AND type = ?
         AND deleted_at IS NULL`,
    )
    .get(name, type) as TagRow | undefined;
}

function checkTagUniqueness(
  name: string,
  type: TagType,
  excludeId?: string,
): void {
  const db = getDb();
  const existing = excludeId
    ? db
        .prepare(
          `SELECT 1
           FROM tags
           WHERE lower(trim(name)) = lower(trim(?))
             AND type = ?
             AND deleted_at IS NULL
             AND id != ?`,
        )
        .get(name, type, excludeId)
    : db
        .prepare(
          `SELECT 1
           FROM tags
           WHERE lower(trim(name)) = lower(trim(?))
             AND type = ?
             AND deleted_at IS NULL`,
        )
        .get(name, type);

  if (existing) {
    throw new Error(
      `A tag with the name "${name}" and type "${type}" already exists`,
    );
  }
}

export function createTag(data: {
  name: string;
  type?: TagType;
  color?: string | null;
}): Tag {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = requireNormalizedName(data.name);
  const type = normalizeTagType(data.type);

  checkTagUniqueness(name, type);

  db.prepare(
    "INSERT INTO tags (id, name, type, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, name, type, data.color ?? null, now, now);

  const row = db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as TagRow;
  return rowToTag(row);
}

export function getTags(): Tag[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM tags WHERE deleted_at IS NULL ORDER BY type, lower(name), created_at",
    )
    .all() as TagRow[];
  return rows.map(rowToTag);
}

export function getTagById(id: string): Tag | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM tags WHERE id = ? AND deleted_at IS NULL")
    .get(id) as TagRow | undefined;
  return row ? rowToTag(row) : undefined;
}

export function updateTag(
  id: string,
  updates: { name?: string; type?: TagType; color?: string | null },
): Tag {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT * FROM tags WHERE id = ? AND deleted_at IS NULL")
    .get(id) as TagRow | undefined;

  if (!existing) {
    throw new Error(`Tag with id "${id}" not found`);
  }

  const name =
    updates.name !== undefined
      ? requireNormalizedName(updates.name)
      : existing.name;
  const type = updates.type ?? (existing.type as TagType);
  const color = updates.color !== undefined ? updates.color : existing.color;

  if (name !== existing.name || type !== existing.type) {
    checkTagUniqueness(name, type, id);
  }

  db.prepare(
    "UPDATE tags SET name = ?, type = ?, color = ?, updated_at = ? WHERE id = ?",
  ).run(name, type, color, now, id);

  const row = db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as TagRow;
  return rowToTag(row);
}

export function deleteTag(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .prepare(
      "UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .run(now, now, id);

  if (result.changes === 0) {
    throw new Error(`Tag with id "${id}" not found`);
  }
}

export function restoreTag(id: string): Tag {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM tags WHERE id = ?")
    .get(id) as TagRow | undefined;
  if (!existing || existing.deleted_at === null) {
    throw new Error(`Tag with id "${id}" not found`);
  }

  checkTagUniqueness(existing.name, existing.type as TagType, id);

  db.prepare(
    "UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ?",
  ).run(now, id);

  const row = db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as TagRow;
  return rowToTag(row);
}

export function assertActiveTags(tagIds: string[]): string[] {
  const db = getDb();
  const uniqueIds: string[] = [];
  const seen = new Set<string>();

  for (const id of tagIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
  }

  const stmt = db.prepare(
    "SELECT 1 FROM tags WHERE id = ? AND deleted_at IS NULL",
  );
  for (const id of uniqueIds) {
    if (!stmt.get(id)) {
      throw new Error(`Tag with id "${id}" not found`);
    }
  }

  return uniqueIds;
}

export function getTagsForTransactions(
  transactionIds: string[],
): Map<string, Tag[]> {
  const db = getDb();
  const result = new Map<string, Tag[]>();
  if (transactionIds.length === 0) return result;

  for (const transactionId of transactionIds) {
    result.set(transactionId, []);
  }

  const uniqueTransactionIds = Array.from(new Set(transactionIds));
  const placeholders = uniqueTransactionIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT tt.transaction_id, tag.*
       FROM transaction_tags tt
       JOIN tags tag ON tag.id = tt.tag_id AND tag.deleted_at IS NULL
       WHERE tt.transaction_id IN (${placeholders})
       ORDER BY tt.created_at, lower(tag.name)`,
    )
    .all(...uniqueTransactionIds) as TransactionTagRow[];

  for (const row of rows) {
    const tags = result.get(row.transaction_id) ?? [];
    tags.push(rowToTag(row));
    result.set(row.transaction_id, tags);
  }

  return result;
}

export function replaceTransactionTags(
  transactionId: string,
  tagIds: string[],
): void {
  const db = getDb();
  const activeTagIds = assertActiveTags(tagIds);
  const replaceTags = db.transaction(() => {
    db.prepare("DELETE FROM transaction_tags WHERE transaction_id = ?").run(
      transactionId,
    );
    const stmt = db.prepare(
      "INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)",
    );
    for (const tagId of activeTagIds) {
      stmt.run(transactionId, tagId);
    }
  });

  replaceTags();
}

export function addTransactionTags(
  transactionId: string,
  tagIds: string[],
): void {
  const db = getDb();
  const activeTagIds = assertActiveTags(tagIds);
  if (activeTagIds.length === 0) return;

  const addTags = db.transaction(() => {
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)",
    );
    for (const tagId of activeTagIds) {
      stmt.run(transactionId, tagId);
    }
  });

  addTags();
}

export function removeTransactionTags(
  transactionId: string,
  tagIds: string[],
): void {
  const db = getDb();
  const activeTagIds = assertActiveTags(tagIds);
  if (activeTagIds.length === 0) return;

  const placeholders = activeTagIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM transaction_tags
     WHERE transaction_id = ?
       AND tag_id IN (${placeholders})`,
  ).run(transactionId, ...activeTagIds);
}

export function resolveOrCreateTagsByName(
  items: Array<{ name: string; type?: TagType }>,
): Tag[] {
  const tagsByKey = new Map<string, Tag>();
  const resolvedTags: Tag[] = [];

  for (const item of items) {
    const name = requireNormalizedName(item.name);
    const type = normalizeTagType(item.type);
    const key = `${type}:${name.toLowerCase()}`;
    const cached = tagsByKey.get(key);
    if (cached) {
      resolvedTags.push(cached);
      continue;
    }

    const existing = findActiveTagByNameAndType(name, type);
    const tag = existing ? rowToTag(existing) : createTag({ name, type });
    tagsByKey.set(key, tag);
    resolvedTags.push(tag);
  }

  return resolvedTags;
}
