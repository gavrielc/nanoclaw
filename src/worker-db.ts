/**
 * Worker Database — Schema + CRUD for multi-node workers.
 *
 * Tables:
 * - workers: registered remote worker nodes
 * - worker_nonces: replay protection for HMAC+TTL auth
 */
import Database from 'better-sqlite3';

let db: Database.Database;

export interface Worker {
  id: string;
  ssh_host: string;
  ssh_user: string;
  ssh_port: number;
  local_port: number;
  remote_port: number;
  status: 'online' | 'offline';
  max_wip: number;
  current_wip: number;
  shared_secret: string;
  callback_url: string | null;
  ssh_identity_file: string | null;
  /** JSON array of group folders this worker serves (null = deny all) */
  groups_json: string | null;
  created_at: string;
  updated_at: string;
}

export function createWorkersSchema(database: Database.Database): void {
  db = database;

  database.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      ssh_host TEXT NOT NULL,
      ssh_user TEXT NOT NULL,
      ssh_port INTEGER NOT NULL DEFAULT 22,
      local_port INTEGER NOT NULL,
      remote_port INTEGER NOT NULL DEFAULT 7801,
      status TEXT NOT NULL DEFAULT 'offline',
      max_wip INTEGER NOT NULL DEFAULT 2,
      current_wip INTEGER NOT NULL DEFAULT 0,
      shared_secret TEXT NOT NULL,
      callback_url TEXT,
      ssh_identity_file TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS worker_nonces (
      request_id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL
    );
  `);

  // Migration: add groups_json column (deny-by-default)
  try {
    database.exec(`ALTER TABLE workers ADD COLUMN groups_json TEXT`);
  } catch { /* column already exists */ }
}

/**
 * Deny-by-default: worker must explicitly list the group in groups_json.
 * Returns false if groups_json is null/empty/invalid.
 */
export function workerServesGroup(worker: Worker, group: string): boolean {
  if (!worker.groups_json) return false;
  try {
    const groups: unknown = JSON.parse(worker.groups_json);
    if (!Array.isArray(groups)) return false;
    return groups.includes(group);
  } catch {
    return false;
  }
}

// --- Workers CRUD ---

export function getWorkerById(id: string): Worker | undefined {
  return db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as
    | Worker
    | undefined;
}

export function getAllWorkers(): Worker[] {
  return db
    .prepare('SELECT * FROM workers ORDER BY id')
    .all() as Worker[];
}

export function getOnlineWorkers(): Worker[] {
  return db
    .prepare("SELECT * FROM workers WHERE status = 'online' ORDER BY id")
    .all() as Worker[];
}

export function upsertWorker(worker: Worker): void {
  db.prepare(
    `INSERT INTO workers
       (id, ssh_host, ssh_user, ssh_port, local_port, remote_port,
        status, max_wip, current_wip, shared_secret, callback_url,
        ssh_identity_file, groups_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ssh_host = excluded.ssh_host,
       ssh_user = excluded.ssh_user,
       ssh_port = excluded.ssh_port,
       local_port = excluded.local_port,
       remote_port = excluded.remote_port,
       status = excluded.status,
       max_wip = excluded.max_wip,
       shared_secret = excluded.shared_secret,
       callback_url = excluded.callback_url,
       ssh_identity_file = excluded.ssh_identity_file,
       groups_json = excluded.groups_json,
       updated_at = excluded.updated_at`,
  ).run(
    worker.id,
    worker.ssh_host,
    worker.ssh_user,
    worker.ssh_port,
    worker.local_port,
    worker.remote_port,
    worker.status,
    worker.max_wip,
    worker.current_wip,
    worker.shared_secret,
    worker.callback_url,
    worker.ssh_identity_file,
    worker.groups_json,
    worker.created_at,
    worker.updated_at,
  );
}

export function updateWorkerStatus(id: string, status: Worker['status']): void {
  db.prepare(
    `UPDATE workers SET status = ?, updated_at = ? WHERE id = ?`,
  ).run(status, new Date().toISOString(), id);
}

/**
 * Atomic WIP increment/decrement.
 * delta = +1 for dispatch, -1 for completion.
 */
export function updateWorkerWip(id: string, delta: number): void {
  db.prepare(
    `UPDATE workers SET current_wip = current_wip + ?, updated_at = ? WHERE id = ?`,
  ).run(delta, new Date().toISOString(), id);
}

// --- Nonces (replay protection) ---

export function isNonceUsed(requestId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM worker_nonces WHERE request_id = ?')
    .get(requestId);
  return !!row;
}

export function recordNonce(requestId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO worker_nonces (request_id, received_at) VALUES (?, ?)`,
  ).run(requestId, new Date().toISOString());
}

/**
 * Delete nonces older than the given age.
 * Returns the number of rows deleted.
 */
export function cleanupOldNonces(olderThanMs: number): number {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = db.prepare(
    `DELETE FROM worker_nonces WHERE received_at < ?`,
  ).run(cutoff);
  return result.changes;
}

/**
 * Cap the nonces table to at most maxRows, deleting oldest first.
 * Returns the number of rows deleted.
 */
export function capNonces(maxRows: number): number {
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM worker_nonces').get() as { cnt: number }).cnt;
  if (count <= maxRows) return 0;
  const excess = count - maxRows;
  const result = db.prepare(
    `DELETE FROM worker_nonces WHERE request_id IN (
      SELECT request_id FROM worker_nonces ORDER BY received_at ASC LIMIT ?
    )`,
  ).run(excess);
  return result.changes;
}

/**
 * Legacy alias — kept for backward compatibility.
 */
export function cleanupExpiredNonces(): void {
  cleanupOldNonces(3_600_000); // 1 hour
}
