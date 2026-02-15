/**
 * Memory storage — schema, CRUD, keyword search, access logging.
 * Follows src/ext-broker-db.ts pattern: module-level db, createMemorySchema() called from db.ts.
 */
import Database from 'better-sqlite3';

import type { Memory, MemoryAccessLog } from './memory/constants.js';

let db: Database.Database;

export function createMemorySchema(database: Database.Database): void {
  db = database;

  database.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'L1',
      scope TEXT NOT NULL DEFAULT 'COMPANY',
      product_id TEXT,
      group_folder TEXT NOT NULL,
      tags TEXT,
      pii_detected INTEGER NOT NULL DEFAULT 0,
      pii_types TEXT,
      source_type TEXT NOT NULL DEFAULT 'agent',
      source_ref TEXT,
      policy_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_memories_level ON memories(level);
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
    CREATE INDEX IF NOT EXISTS idx_memories_product ON memories(product_id);
    CREATE INDEX IF NOT EXISTS idx_memories_group ON memories(group_folder);
    CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_type, source_ref);

    CREATE TABLE IF NOT EXISTS memory_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      accessor_group TEXT NOT NULL,
      access_type TEXT NOT NULL,
      granted INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mem_access_memory ON memory_access_log(memory_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mem_access_group ON memory_access_log(accessor_group, created_at);
  `);
}

/** Store a memory (UPSERT — preserves created_at on conflict). */
export function storeMemory(memory: Omit<Memory, 'version'>): void {
  db.prepare(
    `INSERT INTO memories
       (id, content, content_hash, level, scope, product_id, group_folder,
        tags, pii_detected, pii_types, source_type, source_ref,
        policy_version, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       content = excluded.content,
       content_hash = excluded.content_hash,
       level = excluded.level,
       scope = excluded.scope,
       product_id = excluded.product_id,
       tags = excluded.tags,
       pii_detected = excluded.pii_detected,
       pii_types = excluded.pii_types,
       policy_version = excluded.policy_version,
       updated_at = excluded.updated_at`,
  ).run(
    memory.id,
    memory.content,
    memory.content_hash,
    memory.level,
    memory.scope,
    memory.product_id ?? null,
    memory.group_folder,
    memory.tags ?? null,
    memory.pii_detected,
    memory.pii_types ?? null,
    memory.source_type,
    memory.source_ref ?? null,
    memory.policy_version ?? null,
    memory.created_at,
    memory.updated_at,
  );
}

/** Get a single memory by ID. */
export function getMemoryById(id: string): Memory | undefined {
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
    | Memory
    | undefined;
}

/** List memories for a group, newest first. */
export function getMemoriesByGroup(
  groupFolder: string,
  limit = 100,
): Memory[] {
  return db
    .prepare(
      'SELECT * FROM memories WHERE group_folder = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(groupFolder, limit) as Memory[];
}

/** List memories for a product with level ceiling. */
export function getMemoriesByProduct(
  productId: string,
  maxLevel: string,
  limit = 100,
): Memory[] {
  return db
    .prepare(
      `SELECT * FROM memories
       WHERE product_id = ? AND level <= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(productId, maxLevel, limit) as Memory[];
}

/** Keyword search across memories using LIKE. */
export function searchMemoriesByKeywords(
  keywords: string[],
  filters: {
    scope?: string;
    productId?: string | null;
    groupFolder?: string;
    maxLevel?: string;
    limit?: number;
  },
): Memory[] {
  if (keywords.length === 0) return [];

  const conditions: string[] = [];
  const params: unknown[] = [];

  // Keyword LIKE conditions (OR'd together)
  const kwConditions = keywords.map(() => 'content LIKE ?');
  conditions.push(`(${kwConditions.join(' OR ')})`);
  for (const kw of keywords) {
    params.push(`%${kw}%`);
  }

  if (filters.scope) {
    conditions.push('scope = ?');
    params.push(filters.scope);
  }
  if (filters.productId !== undefined && filters.productId !== null) {
    conditions.push('product_id = ?');
    params.push(filters.productId);
  }
  if (filters.groupFolder) {
    conditions.push('group_folder = ?');
    params.push(filters.groupFolder);
  }
  if (filters.maxLevel) {
    conditions.push('level <= ?');
    params.push(filters.maxLevel);
  }

  const limit = filters.limit ?? 50;
  params.push(limit);

  return db
    .prepare(
      `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params) as Memory[];
}

/**
 * Optimistic-locking update. Returns true if applied, false if version mismatch.
 */
export function updateMemory(
  id: string,
  expectedVersion: number,
  updates: Partial<
    Pick<Memory, 'content' | 'content_hash' | 'level' | 'tags' | 'pii_detected' | 'pii_types'>
  >,
): boolean {
  const fields: string[] = ['version = version + 1', 'updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  values.push(id, expectedVersion);
  const result = db
    .prepare(
      `UPDATE memories SET ${fields.join(', ')} WHERE id = ? AND version = ?`,
    )
    .run(...values);

  return result.changes > 0;
}

/** Hard delete a memory. */
export function deleteMemory(id: string): boolean {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Append an access log entry (audit trail). */
export function logMemoryAccess(log: MemoryAccessLog): void {
  db.prepare(
    `INSERT INTO memory_access_log
       (memory_id, accessor_group, access_type, granted, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    log.memory_id,
    log.accessor_group,
    log.access_type,
    log.granted,
    log.reason ?? null,
    log.created_at,
  );
}

/** Get access log entries for a memory. */
export function getMemoryAccessLog(
  memoryId: string,
  limit = 50,
): MemoryAccessLog[] {
  return db
    .prepare(
      'SELECT * FROM memory_access_log WHERE memory_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(memoryId, limit) as MemoryAccessLog[];
}

/** Count L3 accesses by a group since a timestamp. */
export function countL3AccessesSince(
  accessorGroup: string,
  sinceTimestamp: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM memory_access_log
       WHERE accessor_group = ? AND created_at > ?`,
    )
    .get(accessorGroup, sinceTimestamp) as { cnt: number };
  return row.cnt;
}
