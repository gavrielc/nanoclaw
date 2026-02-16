/**
 * Rate limits, daily quotas, and provider breakers — SQLite schema + CRUD.
 * Follows src/ext-broker-db.ts pattern: module-level db, createLimitsSchema() called from db.ts.
 */
import Database from 'better-sqlite3';

let db: Database.Database;

// --- Types ---

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProviderBreaker {
  provider: string;
  state: BreakerState;
  fail_count: number;
  last_fail_at: string | null;
  opened_at: string | null;
  last_probe_at: string | null;
  updated_at: string;
}

export interface QuotaDaily {
  op: string;
  scope_key: string;
  day_key: string;
  used: number;
  soft_limit: number;
  hard_limit: number;
}

export interface RateLimitDeny {
  op: string;
  scope_key: string;
  code: string;
  created_at: string;
}

// --- Schema ---

export function createLimitsSchema(database: Database.Database): void {
  db = database;

  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      op TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      window_key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (op, scope_key, window_key)
    );

    CREATE TABLE IF NOT EXISTS quotas_daily (
      op TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      day_key TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      soft_limit INTEGER NOT NULL,
      hard_limit INTEGER NOT NULL,
      PRIMARY KEY (op, scope_key, day_key)
    );

    CREATE TABLE IF NOT EXISTS provider_breakers (
      provider TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'CLOSED',
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_fail_at TEXT,
      opened_at TEXT,
      last_probe_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS limit_denials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_limit_denials_created ON limit_denials(created_at);
  `);
}

// --- Rate limits ---

/** Increment and return new count for the current minute window. */
export function incrementRateLimit(
  op: string,
  scopeKey: string,
): number {
  const windowKey = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  db.prepare(
    `INSERT INTO rate_limits (op, scope_key, window_key, count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(op, scope_key, window_key) DO UPDATE SET count = count + 1`,
  ).run(op, scopeKey, windowKey);

  const row = db
    .prepare(
      'SELECT count FROM rate_limits WHERE op = ? AND scope_key = ? AND window_key = ?',
    )
    .get(op, scopeKey, windowKey) as { count: number } | undefined;

  return row?.count ?? 1;
}

/** Get current count without incrementing. */
export function getRateLimitCount(
  op: string,
  scopeKey: string,
): number {
  const windowKey = new Date().toISOString().slice(0, 16);
  const row = db
    .prepare(
      'SELECT count FROM rate_limits WHERE op = ? AND scope_key = ? AND window_key = ?',
    )
    .get(op, scopeKey, windowKey) as { count: number } | undefined;
  return row?.count ?? 0;
}

/** Purge rate limit entries older than 5 minutes. */
export function purgeOldRateLimits(): void {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 16);
  db.prepare('DELETE FROM rate_limits WHERE window_key < ?').run(cutoff);
}

// --- Daily quotas ---

/** Increment usage and return updated row. */
export function incrementQuota(
  op: string,
  scopeKey: string,
  softLimit: number,
  hardLimit: number,
): QuotaDaily {
  const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  db.prepare(
    `INSERT INTO quotas_daily (op, scope_key, day_key, used, soft_limit, hard_limit)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(op, scope_key, day_key) DO UPDATE SET
       used = used + 1,
       soft_limit = excluded.soft_limit,
       hard_limit = excluded.hard_limit`,
  ).run(op, scopeKey, dayKey, softLimit, hardLimit);

  return db
    .prepare(
      'SELECT * FROM quotas_daily WHERE op = ? AND scope_key = ? AND day_key = ?',
    )
    .get(op, scopeKey, dayKey) as QuotaDaily;
}

/** Get quota without incrementing. */
export function getQuotaToday(
  op: string,
  scopeKey: string,
): QuotaDaily | undefined {
  const dayKey = new Date().toISOString().slice(0, 10);
  return db
    .prepare(
      'SELECT * FROM quotas_daily WHERE op = ? AND scope_key = ? AND day_key = ?',
    )
    .get(op, scopeKey, dayKey) as QuotaDaily | undefined;
}

/** Get all quotas for today. */
export function getAllQuotasToday(): QuotaDaily[] {
  const dayKey = new Date().toISOString().slice(0, 10);
  return db
    .prepare('SELECT * FROM quotas_daily WHERE day_key = ? ORDER BY op, scope_key')
    .all(dayKey) as QuotaDaily[];
}

// --- Provider breakers ---

export function getBreaker(provider: string): ProviderBreaker | undefined {
  return db
    .prepare('SELECT * FROM provider_breakers WHERE provider = ?')
    .get(provider) as ProviderBreaker | undefined;
}

export function getAllBreakers(): ProviderBreaker[] {
  return db
    .prepare('SELECT * FROM provider_breakers ORDER BY provider')
    .all() as ProviderBreaker[];
}

export function upsertBreaker(
  provider: string,
  updates: Partial<Omit<ProviderBreaker, 'provider'>>,
): void {
  const now = new Date().toISOString();
  const existing = getBreaker(provider);

  if (!existing) {
    db.prepare(
      `INSERT INTO provider_breakers (provider, state, fail_count, last_fail_at, opened_at, last_probe_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      provider,
      updates.state ?? 'CLOSED',
      updates.fail_count ?? 0,
      updates.last_fail_at ?? null,
      updates.opened_at ?? null,
      updates.last_probe_at ?? null,
      now,
    );
    return;
  }

  const fields: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (updates.state !== undefined) {
    fields.push('state = ?');
    params.push(updates.state);
  }
  if (updates.fail_count !== undefined) {
    fields.push('fail_count = ?');
    params.push(updates.fail_count);
  }
  if (updates.last_fail_at !== undefined) {
    fields.push('last_fail_at = ?');
    params.push(updates.last_fail_at);
  }
  if (updates.opened_at !== undefined) {
    fields.push('opened_at = ?');
    params.push(updates.opened_at);
  }
  if (updates.last_probe_at !== undefined) {
    fields.push('last_probe_at = ?');
    params.push(updates.last_probe_at);
  }

  params.push(provider);
  db.prepare(
    `UPDATE provider_breakers SET ${fields.join(', ')} WHERE provider = ?`,
  ).run(...params);
}

// --- Denial logging ---

export function logLimitDenial(
  op: string,
  scopeKey: string,
  code: string,
): void {
  db.prepare(
    'INSERT INTO limit_denials (op, scope_key, code, created_at) VALUES (?, ?, ?, ?)',
  ).run(op, scopeKey, code, new Date().toISOString());
}

export function countDenials24h(): number {
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  const row = db
    .prepare('SELECT COUNT(*) as count FROM limit_denials WHERE created_at > ?')
    .get(cutoff) as { count: number };
  return row.count;
}

export function getDenialsByCode24h(): Array<{ code: string; count: number }> {
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  return db
    .prepare(
      `SELECT code, COUNT(*) as count FROM limit_denials
       WHERE created_at > ? GROUP BY code ORDER BY count DESC`,
    )
    .all(cutoff) as Array<{ code: string; count: number }>;
}
