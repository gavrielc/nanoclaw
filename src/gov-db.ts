import Database from 'better-sqlite3';

import type {
  GovActivity,
  GovApproval,
  GovDispatch,
  GovTask,
  Product,
} from './governance/constants.js';

let db: Database.Database;

export function createGovSchema(database: Database.Database): void {
  db = database;

  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      risk_level TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

    CREATE TABLE IF NOT EXISTS gov_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      task_type TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'INBOX',
      priority TEXT NOT NULL DEFAULT 'P2',
      product TEXT,
      product_id TEXT,
      scope TEXT NOT NULL DEFAULT 'PRODUCT',
      assigned_group TEXT,
      executor TEXT,
      created_by TEXT NOT NULL,
      gate TEXT NOT NULL DEFAULT 'None',
      dod_required INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gov_tasks_state ON gov_tasks(state);
    CREATE INDEX IF NOT EXISTS idx_gov_tasks_assigned ON gov_tasks(assigned_group);
    CREATE INDEX IF NOT EXISTS idx_gov_tasks_product ON gov_tasks(product);
    CREATE INDEX IF NOT EXISTS idx_gov_tasks_product_id ON gov_tasks(product_id);
    CREATE INDEX IF NOT EXISTS idx_gov_tasks_scope ON gov_tasks(scope);

    CREATE TABLE IF NOT EXISTS gov_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      action TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT,
      actor TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES gov_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_gov_activities_task ON gov_activities(task_id, created_at);

    CREATE TABLE IF NOT EXISTS gov_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      gate_type TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      notes TEXT,
      FOREIGN KEY (task_id) REFERENCES gov_tasks(id),
      UNIQUE(task_id, gate_type)
    );

    CREATE TABLE IF NOT EXISTS gov_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      dispatch_key TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ENQUEUED',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(dispatch_key)
    );
    CREATE INDEX IF NOT EXISTS idx_gov_dispatches_task ON gov_dispatches(task_id);
  `);

  // Additive migrations for existing databases
  runGovMigrations(database);
}

/**
 * Additive-only column migrations for existing DBs.
 * Each migration is guarded by try/catch — duplicate column errors are ignored.
 */
function runGovMigrations(database: Database.Database): void {
  // Migration 001: Add product_id column to gov_tasks
  try { database.exec(`ALTER TABLE gov_tasks ADD COLUMN product_id TEXT`); } catch { /* already exists */ }
  // Migration 002: Add scope column to gov_tasks
  try { database.exec(`ALTER TABLE gov_tasks ADD COLUMN scope TEXT NOT NULL DEFAULT 'PRODUCT'`); } catch { /* already exists */ }
  // Migration 003: Add worker_id column to gov_dispatches
  try { database.exec(`ALTER TABLE gov_dispatches ADD COLUMN worker_id TEXT`); } catch { /* already exists */ }
}

// --- Products CRUD ---

export function createProduct(product: Product): void {
  db.prepare(
    `INSERT INTO products (id, name, status, risk_level, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       status = excluded.status,
       risk_level = excluded.risk_level,
       updated_at = excluded.updated_at`,
  ).run(
    product.id,
    product.name,
    product.status,
    product.risk_level,
    product.created_at,
    product.updated_at,
  );
}

export function getProductById(id: string): Product | undefined {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
    | Product
    | undefined;
}

export function listProducts(status?: string): Product[] {
  if (status) {
    return db
      .prepare('SELECT * FROM products WHERE status = ? ORDER BY name')
      .all(status) as Product[];
  }
  return db
    .prepare('SELECT * FROM products ORDER BY name')
    .all() as Product[];
}

export function updateProduct(
  id: string,
  updates: Partial<Pick<Product, 'name' | 'status' | 'risk_level'>>,
): boolean {
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  values.push(id);
  const result = db
    .prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);

  return result.changes > 0;
}

// --- Gov Tasks CRUD ---

export function createGovTask(
  task: Omit<GovTask, 'version'>,
): void {
  db.prepare(
    `INSERT INTO gov_tasks
       (id, title, description, task_type, state, priority, product, product_id, scope,
        assigned_group, executor, created_by, gate, dod_required, version,
        metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       task_type = excluded.task_type,
       state = excluded.state,
       priority = excluded.priority,
       product = excluded.product,
       product_id = excluded.product_id,
       scope = excluded.scope,
       assigned_group = excluded.assigned_group,
       executor = excluded.executor,
       gate = excluded.gate,
       dod_required = excluded.dod_required,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
  ).run(
    task.id,
    task.title,
    task.description,
    task.task_type,
    task.state,
    task.priority,
    task.product,
    task.product_id,
    task.scope,
    task.assigned_group,
    task.executor,
    task.created_by,
    task.gate,
    task.dod_required,
    task.metadata,
    task.created_at,
    task.updated_at,
  );
}

export function getGovTaskById(id: string): GovTask | undefined {
  return db.prepare('SELECT * FROM gov_tasks WHERE id = ?').get(id) as
    | GovTask
    | undefined;
}

export function getGovTasksByState(state: string): GovTask[] {
  return db
    .prepare('SELECT * FROM gov_tasks WHERE state = ? ORDER BY priority, created_at')
    .all(state) as GovTask[];
}

export function getGovTasksByGroup(groupFolder: string): GovTask[] {
  return db
    .prepare(
      'SELECT * FROM gov_tasks WHERE assigned_group = ? ORDER BY priority, created_at',
    )
    .all(groupFolder) as GovTask[];
}

export function getAllGovTasks(): GovTask[] {
  return db
    .prepare('SELECT * FROM gov_tasks ORDER BY priority, created_at')
    .all() as GovTask[];
}

export function getGovTasksByProduct(productId: string): GovTask[] {
  return db
    .prepare(
      'SELECT * FROM gov_tasks WHERE product_id = ? ORDER BY priority, created_at',
    )
    .all(productId) as GovTask[];
}

export function getGovTasksByScope(scope: string): GovTask[] {
  return db
    .prepare(
      'SELECT * FROM gov_tasks WHERE scope = ? ORDER BY priority, created_at',
    )
    .all(scope) as GovTask[];
}

/**
 * Count tasks in DOING state for a group — used for WIP limits.
 */
export function countDoingTasksByGroup(groupFolder: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM gov_tasks WHERE state = 'DOING' AND assigned_group = ?`,
    )
    .get(groupFolder) as { cnt: number };
  return row.cnt;
}


/**
 * Optimistic-locking update: only succeeds if version matches.
 * Increments version on success.
 * Returns true if update was applied, false if version mismatch (stale).
 */
export function updateGovTask(
  id: string,
  expectedVersion: number,
  updates: Partial<
    Pick<
      GovTask,
      | 'title'
      | 'description'
      | 'state'
      | 'priority'
      | 'product'
      | 'product_id'
      | 'scope'
      | 'assigned_group'
      | 'executor'
      | 'gate'
      | 'dod_required'
      | 'metadata'
    >
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
      `UPDATE gov_tasks SET ${fields.join(', ')} WHERE id = ? AND version = ?`,
    )
    .run(...values);

  return result.changes > 0;
}

/**
 * Tasks in READY state with an assigned_group — candidates for auto-dispatch.
 */
export function getDispatchableGovTasks(): GovTask[] {
  return db
    .prepare(
      `SELECT * FROM gov_tasks
       WHERE state = 'READY' AND assigned_group IS NOT NULL
       ORDER BY priority, created_at`,
    )
    .all() as GovTask[];
}

/**
 * Tasks in REVIEW state with a gate != 'None' — candidates for gate dispatch.
 */
export function getReviewableGovTasks(): GovTask[] {
  return db
    .prepare(
      `SELECT * FROM gov_tasks
       WHERE state = 'REVIEW' AND gate != 'None'
       ORDER BY priority, created_at`,
    )
    .all() as GovTask[];
}

// --- Gov Activities (append-only) ---

export function logGovActivity(activity: GovActivity): void {
  db.prepare(
    `INSERT INTO gov_activities (task_id, action, from_state, to_state, actor, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.task_id,
    activity.action,
    activity.from_state,
    activity.to_state,
    activity.actor,
    activity.reason,
    activity.created_at,
  );
}

export function getGovActivities(taskId: string): GovActivity[] {
  return db
    .prepare(
      'SELECT * FROM gov_activities WHERE task_id = ? ORDER BY created_at',
    )
    .all(taskId) as GovActivity[];
}

/**
 * Sprint 2: Context-useful activities for cross-agent review prompts.
 * Filters to: transition, approve, evidence, execution_summary, coerce_scope.
 */
const CONTEXT_ACTIONS = ['transition', 'approve', 'evidence', 'execution_summary', 'coerce_scope'];

export function getGovActivitiesForContext(
  taskId: string,
  limit = 50,
): GovActivity[] {
  const placeholders = CONTEXT_ACTIONS.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT * FROM gov_activities
       WHERE task_id = ? AND action IN (${placeholders})
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(taskId, ...CONTEXT_ACTIONS, limit) as GovActivity[];
}

/**
 * Sprint 2: Get execution summary for a task (v0 heuristic).
 * 1. Preferred: latest activity with action='execution_summary' → its reason
 * 2. Fallback: last DOING→REVIEW transition → its reason
 * Returns null if neither exists.
 */
export function getGovTaskExecutionSummary(taskId: string): string | null {
  // Preferred: execution_summary activity
  const summaryActivity = db
    .prepare(
      `SELECT reason FROM gov_activities
       WHERE task_id = ? AND action = 'execution_summary'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(taskId) as { reason: string | null } | undefined;

  if (summaryActivity?.reason) return summaryActivity.reason;

  // Fallback: DOING→REVIEW transition reason
  const transitionActivity = db
    .prepare(
      `SELECT reason FROM gov_activities
       WHERE task_id = ? AND action = 'transition'
         AND from_state = 'DOING' AND to_state = 'REVIEW'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(taskId) as { reason: string | null } | undefined;

  return transitionActivity?.reason || null;
}

// --- Gov Approvals (idempotent via UNIQUE) ---

export function createGovApproval(approval: GovApproval): void {
  db.prepare(
    `INSERT OR REPLACE INTO gov_approvals (task_id, gate_type, approved_by, approved_at, notes)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    approval.task_id,
    approval.gate_type,
    approval.approved_by,
    approval.approved_at,
    approval.notes,
  );
}

export function getGovApprovals(taskId: string): GovApproval[] {
  return db
    .prepare('SELECT * FROM gov_approvals WHERE task_id = ? ORDER BY approved_at')
    .all(taskId) as GovApproval[];
}

// --- Gov Dispatches (idempotent via UNIQUE dispatch_key) ---

/**
 * Try to claim a dispatch slot. Returns true if claimed (new record inserted).
 * Returns false if dispatch_key already exists (already dispatched).
 */
export function tryCreateDispatch(dispatch: GovDispatch): boolean {
  try {
    db.prepare(
      `INSERT INTO gov_dispatches
         (task_id, from_state, to_state, dispatch_key, group_jid, worker_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      dispatch.task_id,
      dispatch.from_state,
      dispatch.to_state,
      dispatch.dispatch_key,
      dispatch.group_jid,
      dispatch.worker_id || null,
      dispatch.status,
      dispatch.created_at,
      dispatch.updated_at,
    );
    return true;
  } catch (err: unknown) {
    // UNIQUE constraint violation = already dispatched
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return false;
    }
    throw err;
  }
}

export function updateDispatchStatus(
  dispatchKey: string,
  status: GovDispatch['status'],
): void {
  db.prepare(
    `UPDATE gov_dispatches SET status = ?, updated_at = ? WHERE dispatch_key = ?`,
  ).run(status, new Date().toISOString(), dispatchKey);
}

export function getDispatchByKey(
  dispatchKey: string,
): GovDispatch | undefined {
  return db
    .prepare('SELECT * FROM gov_dispatches WHERE dispatch_key = ?')
    .get(dispatchKey) as GovDispatch | undefined;
}

export function getDispatchesByWorkerId(
  workerId: string,
  limit: number = 20,
): GovDispatch[] {
  return db
    .prepare(
      'SELECT * FROM gov_dispatches WHERE worker_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(workerId, limit) as GovDispatch[];
}
