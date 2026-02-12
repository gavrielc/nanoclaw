import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import {
  getUserRole,
  isAdmin,
  setUserRole,
  tempBlockUser,
  isUserTempBlocked,
  unblockUser,
  autoAssignAdminRole,
} from './roles.js';
import type { UserRole } from './types.js';

let db: Database.Database;

/** Create in-memory DB with complaint schema + role columns. */
function setupDb(): Database.Database {
  const database = new Database(':memory:');

  // Base users table from 001-complaints.sql
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      name TEXT,
      language TEXT DEFAULT 'mr',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      total_complaints INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0
    );
  `);

  // 002 migration columns
  database.exec(`
    ALTER TABLE users ADD COLUMN date_of_birth TEXT;
    ALTER TABLE users ADD COLUMN block_reason TEXT;
  `);

  // 003 migration columns (what we're building)
  database.exec(`
    ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
    ALTER TABLE users ADD COLUMN blocked_until TEXT;
  `);

  // tenant_config table
  database.exec(`
    CREATE TABLE IF NOT EXISTS tenant_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed block_duration_hours
  database
    .prepare(
      "INSERT INTO tenant_config (key, value) VALUES ('block_duration_hours', '24')",
    )
    .run();

  return database;
}

function insertUser(
  database: Database.Database,
  phone: string,
  overrides: Record<string, unknown> = {},
): void {
  const now = new Date().toISOString();
  const defaults: Record<string, unknown> = {
    name: null,
    language: 'mr',
    first_seen: now,
    last_seen: now,
    total_complaints: 0,
    is_blocked: 0,
    role: 'user',
    blocked_until: null,
  };
  const merged = { ...defaults, ...overrides };
  database
    .prepare(
      `INSERT INTO users (phone, name, language, first_seen, last_seen, total_complaints, is_blocked, role, blocked_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      phone,
      merged.name,
      merged.language,
      merged.first_seen,
      merged.last_seen,
      merged.total_complaints,
      merged.is_blocked,
      merged.role,
      merged.blocked_until,
    );
}

beforeEach(() => {
  db = setupDb();
});

afterEach(() => {
  db.close();
});

// ============================================================
// getUserRole
// ============================================================

describe('getUserRole', () => {
  it('returns "user" for unknown phone (no row)', () => {
    expect(getUserRole(db, '919999999999')).toBe('user');
  });

  it('returns "user" for existing user with default role', () => {
    insertUser(db, '919876543210');
    expect(getUserRole(db, '919876543210')).toBe('user');
  });

  it('returns correct role after setUserRole', () => {
    insertUser(db, '919876543210');
    setUserRole(db, '919876543210', 'karyakarta', 'superadmin');
    expect(getUserRole(db, '919876543210')).toBe('karyakarta');
  });
});

// ============================================================
// isAdmin
// ============================================================

describe('isAdmin', () => {
  it('returns false for regular user', () => {
    insertUser(db, '919876543210');
    expect(isAdmin(db, '919876543210')).toBe(false);
  });

  it('returns false for karyakarta', () => {
    insertUser(db, '919876543210', { role: 'karyakarta' });
    expect(isAdmin(db, '919876543210')).toBe(false);
  });

  it('returns true for admin', () => {
    insertUser(db, '919876543210', { role: 'admin' });
    expect(isAdmin(db, '919876543210')).toBe(true);
  });

  it('returns true for superadmin', () => {
    insertUser(db, '919876543210', { role: 'superadmin' });
    expect(isAdmin(db, '919876543210')).toBe(true);
  });

  it('returns false for unknown user', () => {
    expect(isAdmin(db, '919999999999')).toBe(false);
  });
});

// ============================================================
// setUserRole
// ============================================================

describe('setUserRole', () => {
  beforeEach(() => {
    insertUser(db, '919876543210');
  });

  it('superadmin can promote to admin', () => {
    const result = setUserRole(db, '919876543210', 'admin', 'superadmin');
    expect(result).toBe('OK');
    expect(getUserRole(db, '919876543210')).toBe('admin');
  });

  it('superadmin can promote to superadmin', () => {
    const result = setUserRole(db, '919876543210', 'superadmin', 'superadmin');
    expect(result).toBe('OK');
    expect(getUserRole(db, '919876543210')).toBe('superadmin');
  });

  it('superadmin can set user or karyakarta', () => {
    setUserRole(db, '919876543210', 'karyakarta', 'superadmin');
    expect(getUserRole(db, '919876543210')).toBe('karyakarta');

    setUserRole(db, '919876543210', 'user', 'superadmin');
    expect(getUserRole(db, '919876543210')).toBe('user');
  });

  it('admin can set user role', () => {
    const result = setUserRole(db, '919876543210', 'user', 'admin');
    expect(result).toBe('OK');
  });

  it('admin can set karyakarta role', () => {
    const result = setUserRole(db, '919876543210', 'karyakarta', 'admin');
    expect(result).toBe('OK');
    expect(getUserRole(db, '919876543210')).toBe('karyakarta');
  });

  it('admin cannot promote to admin', () => {
    const result = setUserRole(db, '919876543210', 'admin', 'admin');
    expect(result).toContain('Only superadmin');
    expect(getUserRole(db, '919876543210')).toBe('user'); // unchanged
  });

  it('admin cannot promote to superadmin', () => {
    const result = setUserRole(db, '919876543210', 'superadmin', 'admin');
    expect(result).toContain('Only superadmin');
    expect(getUserRole(db, '919876543210')).toBe('user'); // unchanged
  });

  it('user caller cannot change roles', () => {
    const result = setUserRole(db, '919876543210', 'karyakarta', 'user');
    expect(result).toContain('Only admin');
    expect(getUserRole(db, '919876543210')).toBe('user'); // unchanged
  });

  it('karyakarta caller cannot change roles', () => {
    const result = setUserRole(db, '919876543210', 'admin', 'karyakarta');
    expect(result).toContain('Only admin');
    expect(getUserRole(db, '919876543210')).toBe('user'); // unchanged
  });
});

// ============================================================
// tempBlockUser
// ============================================================

describe('tempBlockUser', () => {
  it('sets blocked_until to now + hours', () => {
    insertUser(db, '919876543210');
    const result = tempBlockUser(db, '919876543210', 'Spam messages', 24);
    expect(result).toBe('OK');

    const row = db
      .prepare('SELECT is_blocked, blocked_until FROM users WHERE phone = ?')
      .get('919876543210') as {
      is_blocked: number;
      blocked_until: string;
    };
    expect(row.is_blocked).toBe(1);
    expect(row.blocked_until).toBeTruthy();

    // Verify blocked_until is approximately 24 hours from now
    const blockedUntil = new Date(row.blocked_until).getTime();
    const expectedApprox = Date.now() + 24 * 60 * 60 * 1000;
    expect(Math.abs(blockedUntil - expectedApprox)).toBeLessThan(5000); // within 5 seconds
  });

  it('refuses to block admin', () => {
    insertUser(db, '919876543210', { role: 'admin' });
    const result = tempBlockUser(db, '919876543210', 'Test', 24);
    expect(result).toContain('cannot be blocked');
  });

  it('refuses to block superadmin', () => {
    insertUser(db, '919876543210', { role: 'superadmin' });
    const result = tempBlockUser(db, '919876543210', 'Test', 24);
    expect(result).toContain('cannot be blocked');
  });

  it('stores block_reason', () => {
    insertUser(db, '919876543210');
    tempBlockUser(db, '919876543210', 'Abusive language', 48);

    const row = db
      .prepare('SELECT block_reason FROM users WHERE phone = ?')
      .get('919876543210') as {
      block_reason: string;
    };
    expect(row.block_reason).toBe('Abusive language');
  });

  it('creates user if not exists', () => {
    const result = tempBlockUser(db, '919999999999', 'Spam', 24);
    expect(result).toBe('OK');

    const row = db
      .prepare('SELECT is_blocked, blocked_until FROM users WHERE phone = ?')
      .get('919999999999') as {
      is_blocked: number;
      blocked_until: string;
    };
    expect(row.is_blocked).toBe(1);
    expect(row.blocked_until).toBeTruthy();
  });
});

// ============================================================
// isUserTempBlocked
// ============================================================

describe('isUserTempBlocked', () => {
  it('returns true when blocked_until is in the future', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    insertUser(db, '919876543210', {
      is_blocked: 1,
      blocked_until: futureDate,
    });
    expect(isUserTempBlocked(db, '919876543210')).toBe(true);
  });

  it('returns false and auto-unblocks when blocked_until is in the past', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    insertUser(db, '919876543210', { is_blocked: 1, blocked_until: pastDate });

    expect(isUserTempBlocked(db, '919876543210')).toBe(false);

    // Verify auto-unblock cleared the fields
    const row = db
      .prepare('SELECT is_blocked, blocked_until FROM users WHERE phone = ?')
      .get('919876543210') as {
      is_blocked: number;
      blocked_until: string | null;
    };
    expect(row.is_blocked).toBe(0);
    expect(row.blocked_until).toBeNull();
  });

  it('always returns false for admin', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    insertUser(db, '919876543210', {
      role: 'admin',
      is_blocked: 1,
      blocked_until: futureDate,
    });
    expect(isUserTempBlocked(db, '919876543210')).toBe(false);
  });

  it('always returns false for superadmin', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    insertUser(db, '919876543210', {
      role: 'superadmin',
      is_blocked: 1,
      blocked_until: futureDate,
    });
    expect(isUserTempBlocked(db, '919876543210')).toBe(false);
  });

  it('returns false for unknown user', () => {
    expect(isUserTempBlocked(db, '919999999999')).toBe(false);
  });

  it('returns false for user with no block', () => {
    insertUser(db, '919876543210');
    expect(isUserTempBlocked(db, '919876543210')).toBe(false);
  });
});

// ============================================================
// unblockUser
// ============================================================

describe('unblockUser', () => {
  it('clears is_blocked and blocked_until', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    insertUser(db, '919876543210', {
      is_blocked: 1,
      blocked_until: futureDate,
      block_reason: 'Spam',
    });

    const result = unblockUser(db, '919876543210');
    expect(result).toBe('OK');

    const row = db
      .prepare('SELECT is_blocked, blocked_until FROM users WHERE phone = ?')
      .get('919876543210') as {
      is_blocked: number;
      blocked_until: string | null;
    };
    expect(row.is_blocked).toBe(0);
    expect(row.blocked_until).toBeNull();
  });

  it('returns message for unknown user', () => {
    const result = unblockUser(db, '919999999999');
    expect(result).toContain('not found');
  });
});

// ============================================================
// autoAssignAdminRole
// ============================================================

describe('autoAssignAdminRole', () => {
  it('sets admin role for matching phone in adminPhones list', () => {
    insertUser(db, '919876543210');
    autoAssignAdminRole(db, '919876543210', ['919876543210', '919111111111']);
    expect(getUserRole(db, '919876543210')).toBe('admin');
  });

  it('does nothing for non-matching phone', () => {
    insertUser(db, '919876543210');
    autoAssignAdminRole(db, '919876543210', ['919111111111', '919222222222']);
    expect(getUserRole(db, '919876543210')).toBe('user');
  });

  it('does not downgrade superadmin', () => {
    insertUser(db, '919876543210', { role: 'superadmin' });
    autoAssignAdminRole(db, '919876543210', ['919876543210']);
    expect(getUserRole(db, '919876543210')).toBe('superadmin');
  });

  it('creates user if not exists and phone matches', () => {
    autoAssignAdminRole(db, '919876543210', ['919876543210']);
    expect(getUserRole(db, '919876543210')).toBe('admin');
  });
});
