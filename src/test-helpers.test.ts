import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import {
  createTestDb,
  seedArea,
  seedUser,
  seedKaryakarta,
  seedComplaint,
} from './test-helpers.js';

let db: Database.Database;

afterEach(() => {
  if (db) db.close();
});

// ============================================================
// createTestDb
// ============================================================

describe('createTestDb', () => {
  it('returns a working in-memory database', () => {
    db = createTestDb();
    expect(db).toBeDefined();
    expect(db.open).toBe(true);
  });

  it('has users table with all columns', () => {
    db = createTestDb();
    const cols = db.pragma('table_info(users)') as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('phone');
    expect(colNames).toContain('role');
    expect(colNames).toContain('blocked_until');
    expect(colNames).toContain('date_of_birth');
    expect(colNames).toContain('block_reason');
  });

  it('has complaints table with area_id column', () => {
    db = createTestDb();
    const cols = db.pragma('table_info(complaints)') as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('area_id');
  });

  it('has areas table', () => {
    db = createTestDb();
    const cols = db.pragma('table_info(areas)') as { name: string }[];
    expect(cols.length).toBeGreaterThan(0);
  });

  it('has karyakartas table', () => {
    db = createTestDb();
    const cols = db.pragma('table_info(karyakartas)') as { name: string }[];
    expect(cols.length).toBeGreaterThan(0);
  });

  it('has karyakarta_areas table', () => {
    db = createTestDb();
    const cols = db.pragma('table_info(karyakarta_areas)') as {
      name: string;
    }[];
    expect(cols.length).toBeGreaterThan(0);
  });

  it('has complaint_validations table', () => {
    db = createTestDb();
    const cols = db.pragma('table_info(complaint_validations)') as {
      name: string;
    }[];
    expect(cols.length).toBeGreaterThan(0);
  });

  it('has tenant_config with complaint_id_prefix', () => {
    db = createTestDb();
    const row = db
      .prepare(
        "SELECT value FROM tenant_config WHERE key = 'complaint_id_prefix'",
      )
      .get() as { value: string };
    expect(row.value).toBe('RK');
  });

  it('has conversations table', () => {
    db = createTestDb();
    const cols = db.pragma('table_info(conversations)') as { name: string }[];
    expect(cols.length).toBeGreaterThan(0);
  });

  it('has categories table', () => {
    db = createTestDb();
    const cols = db.pragma('table_info(categories)') as { name: string }[];
    expect(cols.length).toBeGreaterThan(0);
  });
});

// ============================================================
// seedArea
// ============================================================

describe('seedArea', () => {
  it('creates area and returns slug id', () => {
    db = createTestDb();
    const id = seedArea(db, { name: 'Shivaji Nagar' });
    expect(id).toBe('shivaji-nagar');
  });

  it('creates area with name_mr', () => {
    db = createTestDb();
    seedArea(db, { name: 'Ward 1', name_mr: 'वॉर्ड १' });

    const area = db
      .prepare('SELECT name_mr FROM areas WHERE id = ?')
      .get('ward-1') as { name_mr: string };
    expect(area.name_mr).toBe('वॉर्ड १');
  });
});

// ============================================================
// seedUser
// ============================================================

describe('seedUser', () => {
  it('creates a user with default role', () => {
    db = createTestDb();
    seedUser(db, '919876543210');

    const user = db
      .prepare('SELECT role, language FROM users WHERE phone = ?')
      .get('919876543210') as {
      role: string;
      language: string;
    };
    expect(user.role).toBe('user');
    expect(user.language).toBe('mr');
  });

  it('creates a user with custom role', () => {
    db = createTestDb();
    seedUser(db, '919876543210', { role: 'admin' });

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('admin');
  });

  it('creates a user with custom language', () => {
    db = createTestDb();
    seedUser(db, '919876543210', { language: 'hi' });

    const user = db
      .prepare('SELECT language FROM users WHERE phone = ?')
      .get('919876543210') as { language: string };
    expect(user.language).toBe('hi');
  });
});

// ============================================================
// seedKaryakarta
// ============================================================

describe('seedKaryakarta', () => {
  it('creates user and karyakarta record', () => {
    db = createTestDb();
    seedKaryakarta(db, '919876543210');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('karyakarta');

    const k = db
      .prepare('SELECT * FROM karyakartas WHERE phone = ?')
      .get('919876543210');
    expect(k).toBeDefined();
  });

  it('assigns areas if provided', () => {
    db = createTestDb();
    const area1 = seedArea(db, { name: 'Ward 1' });
    const area2 = seedArea(db, { name: 'Ward 2' });
    seedKaryakarta(db, '919876543210', [area1, area2]);

    const assignments = db
      .prepare(
        'SELECT area_id FROM karyakarta_areas WHERE karyakarta_phone = ?',
      )
      .all('919876543210') as { area_id: string }[];
    expect(assignments).toHaveLength(2);
  });
});

// ============================================================
// seedComplaint
// ============================================================

describe('seedComplaint', () => {
  it('creates complaint with default values', () => {
    db = createTestDb();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, { phone: '919876543210' });

    expect(id).toBeTruthy();
    const complaint = db
      .prepare('SELECT * FROM complaints WHERE id = ?')
      .get(id) as {
      phone: string;
      status: string;
      description: string;
    };
    expect(complaint.phone).toBe('919876543210');
    expect(complaint.status).toBe('registered');
  });

  it('creates complaint with custom id', () => {
    db = createTestDb();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, { phone: '919876543210', id: 'RK-TEST-001' });
    expect(id).toBe('RK-TEST-001');
  });

  it('creates complaint with area_id', () => {
    db = createTestDb();
    const areaId = seedArea(db, { name: 'Ward 1' });
    seedUser(db, '919876543210');
    const id = seedComplaint(db, { phone: '919876543210', area_id: areaId });

    const complaint = db
      .prepare('SELECT area_id FROM complaints WHERE id = ?')
      .get(id) as { area_id: string };
    expect(complaint.area_id).toBe(areaId);
  });

  it('creates complaint with custom status', () => {
    db = createTestDb();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, {
      phone: '919876543210',
      status: 'in_progress',
    });

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(id) as { status: string };
    expect(complaint.status).toBe('in_progress');
  });

  it('creates complaint with custom category', () => {
    db = createTestDb();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, {
      phone: '919876543210',
      category: 'water_supply',
    });

    const complaint = db
      .prepare('SELECT category FROM complaints WHERE id = ?')
      .get(id) as { category: string };
    expect(complaint.category).toBe('water_supply');
  });
});
