import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import {
  slugify,
  createArea,
  getArea,
  listAreas,
  updateArea,
  deactivateArea,
  addKaryakarta,
  removeKaryakarta,
  getKaryakarta,
  listKaryakartas,
  assignKaryakartaToArea,
  unassignKaryakartaFromArea,
  getKaryakartasForArea,
  getAreasForKaryakarta,
  createValidation,
  getValidationsForComplaint,
} from './area-db.js';
import {
  createTestDb,
  seedArea,
  seedUser,
  seedKaryakarta,
  seedComplaint,
} from './test-helpers.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

// ============================================================
// slugify
// ============================================================

describe('slugify', () => {
  it('converts name to lowercase slug', () => {
    expect(slugify('Shivaji Nagar')).toBe('shivaji-nagar');
  });

  it('removes special characters', () => {
    expect(slugify('Ward #7 (East)')).toBe('ward-7-east');
  });

  it('collapses multiple spaces', () => {
    expect(slugify('Pune   City')).toBe('pune-city');
  });

  it('handles single word', () => {
    expect(slugify('Baramati')).toBe('baramati');
  });

  it('handles already-slugified input', () => {
    expect(slugify('shivaji-nagar')).toBe('shivaji-nagar');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify(' Hello World ')).toBe('hello-world');
  });
});

// ============================================================
// Area CRUD
// ============================================================

describe('createArea', () => {
  it('creates area with correct slug', () => {
    const area = createArea(db, { name: 'Shivaji Nagar' });
    expect(area.id).toBe('shivaji-nagar');
    expect(area.name).toBe('Shivaji Nagar');
  });

  it('stores optional name_mr and name_hi', () => {
    createArea(db, { name: 'Ward 7', name_mr: 'वॉर्ड ७', name_hi: 'वार्ड 7' });
    const area = getArea(db, 'ward-7');
    expect(area).not.toBeNull();
    expect(area!.name_mr).toBe('वॉर्ड ७');
    expect(area!.name_hi).toBe('वार्ड 7');
  });

  it('stores type field', () => {
    createArea(db, { name: 'Baramati', type: 'town' });
    const area = getArea(db, 'baramati');
    expect(area!.type).toBe('town');
  });

  it('defaults type to custom', () => {
    createArea(db, { name: 'Zone A' });
    const area = getArea(db, 'zone-a');
    expect(area!.type).toBe('custom');
  });

  it('throws on duplicate name', () => {
    createArea(db, { name: 'Shivaji Nagar' });
    expect(() => createArea(db, { name: 'Shivaji Nagar' })).toThrow();
  });

  it('sets is_active to 1 by default', () => {
    createArea(db, { name: 'Test Area' });
    const area = getArea(db, 'test-area');
    expect(area!.is_active).toBe(1);
  });

  it('sets created_at and updated_at', () => {
    createArea(db, { name: 'Timestamped' });
    const area = getArea(db, 'timestamped');
    expect(area!.created_at).toBeTruthy();
    expect(area!.updated_at).toBeTruthy();
  });
});

describe('getArea', () => {
  it('returns null for non-existent area', () => {
    expect(getArea(db, 'no-such-area')).toBeNull();
  });

  it('returns area by id', () => {
    createArea(db, { name: 'Ward 1' });
    const area = getArea(db, 'ward-1');
    expect(area).not.toBeNull();
    expect(area!.name).toBe('Ward 1');
  });
});

describe('listAreas', () => {
  beforeEach(() => {
    createArea(db, { name: 'Area A' });
    createArea(db, { name: 'Area B' });
    const areaC = createArea(db, { name: 'Area C' });
    deactivateArea(db, areaC.id);
  });

  it('returns only active areas by default', () => {
    const areas = listAreas(db);
    expect(areas).toHaveLength(2);
    const names = areas.map((a) => a.name);
    expect(names).toContain('Area A');
    expect(names).toContain('Area B');
    expect(names).not.toContain('Area C');
  });

  it('returns all areas when activeOnly is false', () => {
    const areas = listAreas(db, { activeOnly: false });
    expect(areas).toHaveLength(3);
  });
});

describe('updateArea', () => {
  it('updates area name', () => {
    createArea(db, { name: 'Old Name' });
    const result = updateArea(db, 'old-name', { name: 'New Name' });
    expect(result).toBe('OK');

    const area = getArea(db, 'old-name');
    expect(area!.name).toBe('New Name');
  });

  it('updates name_mr and name_hi', () => {
    createArea(db, { name: 'Test' });
    updateArea(db, 'test', { name_mr: 'टेस्ट', name_hi: 'टेस्ट हिंदी' });

    const area = getArea(db, 'test');
    expect(area!.name_mr).toBe('टेस्ट');
    expect(area!.name_hi).toBe('टेस्ट हिंदी');
  });

  it('updates updated_at timestamp', () => {
    createArea(db, { name: 'Timestamp Test' });
    const before = getArea(db, 'timestamp-test')!.updated_at;
    // Small delay to ensure different timestamp
    updateArea(db, 'timestamp-test', { name: 'Timestamp Test Updated' });
    const after = getArea(db, 'timestamp-test')!.updated_at;
    expect(after).toBeTruthy();
    // Both should be valid ISO strings
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });

  it('returns error for non-existent area', () => {
    const result = updateArea(db, 'no-such-area', { name: 'Test' });
    expect(result).toContain('not found');
  });
});

describe('deactivateArea', () => {
  it('sets is_active to 0', () => {
    createArea(db, { name: 'To Deactivate' });
    const result = deactivateArea(db, 'to-deactivate');
    expect(result).toBe('OK');

    const area = getArea(db, 'to-deactivate');
    expect(area!.is_active).toBe(0);
  });

  it('returns error for non-existent area', () => {
    const result = deactivateArea(db, 'no-such-area');
    expect(result).toContain('not found');
  });
});

// ============================================================
// Karyakarta CRUD
// ============================================================

describe('addKaryakarta', () => {
  it('creates user with karyakarta role if not exists', () => {
    const result = addKaryakarta(db, '919876543210');
    expect(result).toBe('OK');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('karyakarta');
  });

  it('upgrades user role from user to karyakarta', () => {
    seedUser(db, '919876543210', { role: 'user' });
    addKaryakarta(db, '919876543210');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('karyakarta');
  });

  it('does not downgrade admin role', () => {
    seedUser(db, '919876543210', { role: 'admin' });
    addKaryakarta(db, '919876543210');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('admin');
  });

  it('does not downgrade superadmin role', () => {
    seedUser(db, '919876543210', { role: 'superadmin' });
    addKaryakarta(db, '919876543210');

    const user = db
      .prepare('SELECT role FROM users WHERE phone = ?')
      .get('919876543210') as { role: string };
    expect(user.role).toBe('superadmin');
  });

  it('inserts into karyakartas table', () => {
    addKaryakarta(db, '919876543210');
    const k = getKaryakarta(db, '919876543210');
    expect(k).not.toBeNull();
    expect(k!.is_active).toBe(1);
  });

  it('stores onboarded_by', () => {
    addKaryakarta(db, '919876543210', '919111111111');
    const k = getKaryakarta(db, '919876543210');
    expect(k!.onboarded_by).toBe('919111111111');
  });

  it('reactivates a soft-deleted karyakarta', () => {
    addKaryakarta(db, '919876543210');
    removeKaryakarta(db, '919876543210');
    expect(getKaryakarta(db, '919876543210')!.is_active).toBe(0);

    addKaryakarta(db, '919876543210');
    expect(getKaryakarta(db, '919876543210')!.is_active).toBe(1);
  });
});

describe('removeKaryakarta', () => {
  it('soft-deletes karyakarta (is_active=0)', () => {
    addKaryakarta(db, '919876543210');
    const result = removeKaryakarta(db, '919876543210');
    expect(result).toBe('OK');

    const k = getKaryakarta(db, '919876543210');
    expect(k!.is_active).toBe(0);
  });

  it('returns error for non-existent karyakarta', () => {
    const result = removeKaryakarta(db, '919999999999');
    expect(result).toContain('not found');
  });
});

describe('getKaryakarta', () => {
  it('returns null for non-existent karyakarta', () => {
    expect(getKaryakarta(db, '919999999999')).toBeNull();
  });

  it('returns karyakarta details', () => {
    addKaryakarta(db, '919876543210', '919111111111');
    const k = getKaryakarta(db, '919876543210');
    expect(k).not.toBeNull();
    expect(k!.phone).toBe('919876543210');
    expect(k!.onboarded_by).toBe('919111111111');
  });
});

describe('listKaryakartas', () => {
  beforeEach(() => {
    addKaryakarta(db, '919876543210');
    addKaryakarta(db, '919876543211');
    addKaryakarta(db, '919876543212');
    removeKaryakarta(db, '919876543212');
  });

  it('returns only active karyakartas by default', () => {
    const list = listKaryakartas(db);
    expect(list).toHaveLength(2);
  });

  it('returns all karyakartas when activeOnly is false', () => {
    const list = listKaryakartas(db, { activeOnly: false });
    expect(list).toHaveLength(3);
  });

  it('includes assigned areas', () => {
    const areaId = seedArea(db, { name: 'Ward 1' });
    assignKaryakartaToArea(db, '919876543210', areaId);

    const list = listKaryakartas(db);
    const k = list.find((k) => k.phone === '919876543210');
    expect(k).toBeDefined();
    expect(k!.areas).toHaveLength(1);
    expect(k!.areas[0].id).toBe(areaId);
  });
});

// ============================================================
// Assignment CRUD
// ============================================================

describe('assignKaryakartaToArea', () => {
  let areaId: string;

  beforeEach(() => {
    areaId = seedArea(db, { name: 'Ward 1' });
    addKaryakarta(db, '919876543210');
  });

  it('creates assignment record', () => {
    const result = assignKaryakartaToArea(db, '919876543210', areaId);
    expect(result).toBe('OK');

    const areas = getAreasForKaryakarta(db, '919876543210');
    expect(areas).toHaveLength(1);
    expect(areas[0].id).toBe(areaId);
  });

  it('stores assigned_by', () => {
    assignKaryakartaToArea(db, '919876543210', areaId, '919111111111');

    const row = db
      .prepare(
        'SELECT assigned_by FROM karyakarta_areas WHERE karyakarta_phone = ? AND area_id = ?',
      )
      .get('919876543210', areaId) as { assigned_by: string };
    expect(row.assigned_by).toBe('919111111111');
  });

  it('returns error for non-existent area', () => {
    const result = assignKaryakartaToArea(db, '919876543210', 'no-such-area');
    expect(result).toContain('not found');
  });

  it('returns error for non-existent karyakarta', () => {
    const result = assignKaryakartaToArea(db, '919999999999', areaId);
    expect(result).toContain('not found');
  });

  it('handles duplicate assignment gracefully', () => {
    assignKaryakartaToArea(db, '919876543210', areaId);
    // Second assignment should not throw
    const result = assignKaryakartaToArea(db, '919876543210', areaId);
    expect(result).toBe('OK');

    // Should still have only one record
    const areas = getAreasForKaryakarta(db, '919876543210');
    expect(areas).toHaveLength(1);
  });
});

describe('unassignKaryakartaFromArea', () => {
  let areaId: string;

  beforeEach(() => {
    areaId = seedArea(db, { name: 'Ward 1' });
    addKaryakarta(db, '919876543210');
    assignKaryakartaToArea(db, '919876543210', areaId);
  });

  it('removes assignment', () => {
    const result = unassignKaryakartaFromArea(db, '919876543210', areaId);
    expect(result).toBe('OK');

    const areas = getAreasForKaryakarta(db, '919876543210');
    expect(areas).toHaveLength(0);
  });

  it('returns OK even if assignment does not exist', () => {
    unassignKaryakartaFromArea(db, '919876543210', areaId);
    const result = unassignKaryakartaFromArea(db, '919876543210', areaId);
    expect(result).toBe('OK');
  });
});

describe('getKaryakartasForArea', () => {
  let areaId: string;

  beforeEach(() => {
    areaId = seedArea(db, { name: 'Ward 1' });
    addKaryakarta(db, '919876543210');
    addKaryakarta(db, '919876543211');
    assignKaryakartaToArea(db, '919876543210', areaId);
    assignKaryakartaToArea(db, '919876543211', areaId);
  });

  it('returns assigned karyakartas', () => {
    const karyakartas = getKaryakartasForArea(db, areaId);
    expect(karyakartas).toHaveLength(2);
    const phones = karyakartas.map((k) => k.phone);
    expect(phones).toContain('919876543210');
    expect(phones).toContain('919876543211');
  });

  it('returns empty array for area with no assignments', () => {
    const otherArea = seedArea(db, { name: 'Ward 2' });
    const karyakartas = getKaryakartasForArea(db, otherArea);
    expect(karyakartas).toHaveLength(0);
  });
});

describe('getAreasForKaryakarta', () => {
  it('returns assigned areas', () => {
    const area1 = seedArea(db, { name: 'Ward 1' });
    const area2 = seedArea(db, { name: 'Ward 2' });
    addKaryakarta(db, '919876543210');
    assignKaryakartaToArea(db, '919876543210', area1);
    assignKaryakartaToArea(db, '919876543210', area2);

    const areas = getAreasForKaryakarta(db, '919876543210');
    expect(areas).toHaveLength(2);
    const ids = areas.map((a) => a.id);
    expect(ids).toContain('ward-1');
    expect(ids).toContain('ward-2');
  });

  it('returns empty array for karyakarta with no assignments', () => {
    addKaryakarta(db, '919876543210');
    const areas = getAreasForKaryakarta(db, '919876543210');
    expect(areas).toHaveLength(0);
  });
});

// ============================================================
// Validation CRUD
// ============================================================

describe('createValidation', () => {
  let complaintId: string;

  beforeEach(() => {
    seedUser(db, '919876543210');
    complaintId = seedComplaint(db, { phone: '919876543210' });
  });

  it('inserts validation record', () => {
    seedUser(db, '919111111111', { role: 'karyakarta' });
    const id = createValidation(db, {
      complaint_id: complaintId,
      validated_by: '919111111111',
      action: 'approved',
      comment: 'Looks valid',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('stores all fields correctly', () => {
    seedUser(db, '919111111111', { role: 'karyakarta' });
    createValidation(db, {
      complaint_id: complaintId,
      validated_by: '919111111111',
      action: 'rejected',
      reason_code: 'duplicate',
      comment: 'Already reported',
      ai_suggested_reason: 'This appears to be a duplicate of RK-001',
    });

    const validations = getValidationsForComplaint(db, complaintId);
    expect(validations).toHaveLength(1);
    expect(validations[0].action).toBe('rejected');
    expect(validations[0].reason_code).toBe('duplicate');
    expect(validations[0].comment).toBe('Already reported');
    expect(validations[0].ai_suggested_reason).toBe(
      'This appears to be a duplicate of RK-001',
    );
    expect(validations[0].validated_by).toBe('919111111111');
    expect(validations[0].created_at).toBeTruthy();
  });

  it('handles optional fields as null', () => {
    createValidation(db, {
      complaint_id: complaintId,
      action: 'approved',
    });

    const validations = getValidationsForComplaint(db, complaintId);
    expect(validations[0].validated_by).toBeNull();
    expect(validations[0].reason_code).toBeNull();
    expect(validations[0].comment).toBeNull();
    expect(validations[0].ai_suggested_reason).toBeNull();
  });
});

describe('getValidationsForComplaint', () => {
  let complaintId: string;

  beforeEach(() => {
    seedUser(db, '919876543210');
    complaintId = seedComplaint(db, { phone: '919876543210' });
  });

  it('returns empty array for complaint with no validations', () => {
    const validations = getValidationsForComplaint(db, complaintId);
    expect(validations).toHaveLength(0);
  });

  it('returns validation history ordered by creation', () => {
    createValidation(db, {
      complaint_id: complaintId,
      action: 'rejected',
      reason_code: 'duplicate',
    });
    createValidation(db, {
      complaint_id: complaintId,
      action: 'admin_override',
    });

    const validations = getValidationsForComplaint(db, complaintId);
    expect(validations).toHaveLength(2);
    expect(validations[0].action).toBe('rejected');
    expect(validations[1].action).toBe('admin_override');
  });
});

// ============================================================
// area_id on complaints
// ============================================================

describe('area_id on complaints', () => {
  it('supports area_id column on complaints', () => {
    const areaId = seedArea(db, { name: 'Ward 1' });
    seedUser(db, '919876543210');
    const complaintId = seedComplaint(db, {
      phone: '919876543210',
      area_id: areaId,
    });

    const row = db
      .prepare('SELECT area_id FROM complaints WHERE id = ?')
      .get(complaintId) as { area_id: string };
    expect(row.area_id).toBe('ward-1');
  });

  it('area_id defaults to null', () => {
    seedUser(db, '919876543210');
    const complaintId = seedComplaint(db, { phone: '919876543210' });

    const row = db
      .prepare('SELECT area_id FROM complaints WHERE id = ?')
      .get(complaintId) as { area_id: string | null };
    expect(row.area_id).toBeNull();
  });
});
