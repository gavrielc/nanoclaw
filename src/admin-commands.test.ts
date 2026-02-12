import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

import { executeAdminCommand, isKaryakartaCommand } from './admin-commands.js';
import {
  createTestDb,
  seedArea,
  seedComplaint,
  seedKaryakarta,
  seedUser,
} from './test-helpers.js';

function setup(): Database.Database {
  return createTestDb();
}

describe('isKaryakartaCommand', () => {
  it('returns true for all karyakarta/area commands', () => {
    const cmds = [
      'add-karyakarta',
      'remove-karyakarta',
      'assign-area',
      'unassign-area',
      'add-area',
      'rename-area',
      'remove-area',
      'list-karyakartas',
      'list-areas',
      'override-reject',
    ];
    for (const cmd of cmds) {
      expect(isKaryakartaCommand(cmd)).toBe(true);
    }
  });

  it('returns false for non-karyakarta commands', () => {
    expect(isKaryakartaCommand('update')).toBe(false);
    expect(isKaryakartaCommand('resolve')).toBe(false);
    expect(isKaryakartaCommand('status')).toBe(false);
  });
});

describe('add-karyakarta', () => {
  it('creates karyakarta and assigns to area', () => {
    const db = setup();
    seedArea(db, { name: 'Shivaji Nagar' });

    const result = executeAdminCommand(
      db,
      'add-karyakarta',
      '+919876543210 shivaji-nagar',
      '919999999999',
    );

    expect(result.response).toContain('919876543210');
    expect(result.response).toContain('Shivaji Nagar');

    // Verify karyakarta was created
    const k = db
      .prepare('SELECT * FROM karyakartas WHERE phone = ?')
      .get('919876543210') as any;
    expect(k).toBeDefined();
    expect(k.is_active).toBe(1);

    // Verify area assignment
    const assignment = db
      .prepare('SELECT * FROM karyakarta_areas WHERE karyakarta_phone = ?')
      .get('919876543210') as any;
    expect(assignment).toBeDefined();
    expect(assignment.area_id).toBe('shivaji-nagar');
  });

  it('returns error with invalid area', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'add-karyakarta',
      '+919876543210 nonexistent-area',
      '919999999999',
    );
    expect(result.response).toContain('not found');
  });

  it('returns error when args missing', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'add-karyakarta',
      '',
      '919999999999',
    );
    expect(result.response).toContain('Usage');
  });
});

describe('remove-karyakarta', () => {
  it('deactivates karyakarta', () => {
    const db = setup();
    seedArea(db, { name: 'Kothrud' });
    seedKaryakarta(db, '919876543210', ['kothrud']);

    const result = executeAdminCommand(
      db,
      'remove-karyakarta',
      '+919876543210',
      '919999999999',
    );
    expect(result.response).toContain('919876543210');
    expect(result.response).toContain('removed');

    const k = db
      .prepare('SELECT * FROM karyakartas WHERE phone = ?')
      .get('919876543210') as any;
    expect(k.is_active).toBe(0);
  });

  it('returns error for unknown karyakarta', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'remove-karyakarta',
      '+919999999999',
      '919999999999',
    );
    expect(result.response).toContain('not found');
  });
});

describe('assign-area', () => {
  it('assigns karyakarta to additional area', () => {
    const db = setup();
    seedArea(db, { name: 'Kothrud' });
    seedArea(db, { name: 'Hadapsar' });
    seedKaryakarta(db, '919876543210', ['kothrud']);

    const result = executeAdminCommand(
      db,
      'assign-area',
      '+919876543210 hadapsar',
      '919999999999',
    );
    expect(result.response).toContain('919876543210');
    expect(result.response).toContain('Hadapsar');

    // Verify both areas assigned
    const assignments = db
      .prepare('SELECT * FROM karyakarta_areas WHERE karyakarta_phone = ?')
      .all('919876543210');
    expect(assignments).toHaveLength(2);
  });

  it('returns error when args missing', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'assign-area',
      '+919876543210',
      '919999999999',
    );
    expect(result.response).toContain('Usage');
  });
});

describe('unassign-area', () => {
  it('removes karyakarta from area', () => {
    const db = setup();
    seedArea(db, { name: 'Kothrud' });
    seedArea(db, { name: 'Hadapsar' });
    seedKaryakarta(db, '919876543210', ['kothrud', 'hadapsar']);

    const result = executeAdminCommand(
      db,
      'unassign-area',
      '+919876543210 hadapsar',
      '919999999999',
    );
    expect(result.response).toContain('919876543210');
    expect(result.response).toContain('hadapsar');

    const assignments = db
      .prepare('SELECT * FROM karyakarta_areas WHERE karyakarta_phone = ?')
      .all('919876543210');
    expect(assignments).toHaveLength(1);
  });
});

describe('add-area', () => {
  it('creates area with auto-slug', () => {
    const db = setup();

    const result = executeAdminCommand(
      db,
      'add-area',
      'Shivaji Nagar',
      '919999999999',
    );
    expect(result.response).toContain('Shivaji Nagar');
    expect(result.response).toContain('shivaji-nagar');

    const area = db
      .prepare('SELECT * FROM areas WHERE id = ?')
      .get('shivaji-nagar') as any;
    expect(area).toBeDefined();
    expect(area.name).toBe('Shivaji Nagar');
  });

  it('returns error for duplicate area name', () => {
    const db = setup();
    seedArea(db, { name: 'Shivaji Nagar' });

    const result = executeAdminCommand(
      db,
      'add-area',
      'Shivaji Nagar',
      '919999999999',
    );
    expect(result.response).toContain('already exists');
  });

  it('creates area with Marathi and Hindi names', () => {
    const db = setup();

    const result = executeAdminCommand(
      db,
      'add-area',
      'Boribel | बोरीबेल | बोरीबेल',
      '919999999999',
    );
    expect(result.response).toContain('Boribel');
    expect(result.response).toContain('बोरीबेल');

    const area = db
      .prepare('SELECT * FROM areas WHERE id = ?')
      .get('boribel') as any;
    expect(area.name).toBe('Boribel');
    expect(area.name_mr).toBe('बोरीबेल');
    expect(area.name_hi).toBe('बोरीबेल');
  });

  it('defaults Hindi name to Marathi when only two parts given', () => {
    const db = setup();

    executeAdminCommand(
      db,
      'add-area',
      'Daund City | दौंड शहर',
      '919999999999',
    );

    const area = db
      .prepare('SELECT * FROM areas WHERE id = ?')
      .get('daund-city') as any;
    expect(area.name_mr).toBe('दौंड शहर');
    expect(area.name_hi).toBe('दौंड शहर');
  });

  it('returns error when name is empty', () => {
    const db = setup();
    const result = executeAdminCommand(db, 'add-area', '', '919999999999');
    expect(result.response).toContain('Usage');
  });
});

describe('rename-area', () => {
  it('updates area name', () => {
    const db = setup();
    seedArea(db, { name: 'Shivaji Nagar' });

    const result = executeAdminCommand(
      db,
      'rename-area',
      'shivaji-nagar New Shivaji Nagar',
      '919999999999',
    );
    expect(result.response).toContain('renamed');

    const area = db
      .prepare('SELECT * FROM areas WHERE id = ?')
      .get('shivaji-nagar') as any;
    expect(area.name).toBe('New Shivaji Nagar');
  });

  it('returns error for unknown area', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'rename-area',
      'nonexistent New Name',
      '919999999999',
    );
    expect(result.response).toContain('not found');
  });
});

describe('remove-area', () => {
  it('deactivates area', () => {
    const db = setup();
    seedArea(db, { name: 'Wakad' });

    const result = executeAdminCommand(
      db,
      'remove-area',
      'wakad',
      '919999999999',
    );
    expect(result.response).toContain('wakad');
    expect(result.response).toContain('deactivated');

    const area = db
      .prepare('SELECT * FROM areas WHERE id = ?')
      .get('wakad') as any;
    expect(area.is_active).toBe(0);
  });

  it('returns error for unknown area', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'remove-area',
      'nonexistent',
      '919999999999',
    );
    expect(result.response).toContain('not found');
  });
});

describe('list-karyakartas', () => {
  it('shows formatted list with areas', () => {
    const db = setup();
    seedArea(db, { name: 'Shivaji Nagar' });
    seedArea(db, { name: 'Hadapsar' });
    seedKaryakarta(db, '919876543210', ['shivaji-nagar', 'hadapsar']);
    seedKaryakarta(db, '919876543211', ['shivaji-nagar']);

    const result = executeAdminCommand(
      db,
      'list-karyakartas',
      '',
      '919999999999',
    );
    expect(result.response).toContain('Active Karyakartas (2)');
    expect(result.response).toContain('919876543210');
    expect(result.response).toContain('Shivaji Nagar');
    expect(result.response).toContain('Hadapsar');
    expect(result.response).toContain('919876543211');
  });

  it('shows "(none assigned)" for karyakarta without areas', () => {
    const db = setup();
    seedKaryakarta(db, '919876543212');

    const result = executeAdminCommand(
      db,
      'list-karyakartas',
      '',
      '919999999999',
    );
    expect(result.response).toContain('(none assigned)');
  });

  it('shows empty message when no karyakartas exist', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'list-karyakartas',
      '',
      '919999999999',
    );
    expect(result.response).toContain('No active karyakartas');
  });
});

describe('list-areas', () => {
  it('shows formatted list with karyakarta counts', () => {
    const db = setup();
    seedArea(db, { name: 'Shivaji Nagar' });
    seedArea(db, { name: 'Hadapsar' });
    seedArea(db, { name: 'Wakad' });
    seedKaryakarta(db, '919876543210', ['shivaji-nagar', 'hadapsar']);
    seedKaryakarta(db, '919876543211', ['shivaji-nagar']);

    const result = executeAdminCommand(db, 'list-areas', '', '919999999999');
    expect(result.response).toContain('Active Areas (3)');
    expect(result.response).toContain('Shivaji Nagar (shivaji-nagar)');
    expect(result.response).toMatch(/Shivaji Nagar.*2 karyakartas/);
    expect(result.response).toMatch(/Hadapsar.*1 karyakarta[^s]/);
    expect(result.response).toMatch(/Wakad.*0 karyakartas/);
  });

  it('shows empty message when no areas exist', () => {
    const db = setup();
    const result = executeAdminCommand(db, 'list-areas', '', '919999999999');
    expect(result.response).toContain('No active areas');
  });
});

describe('override-reject', () => {
  it('changes status from rejected to validated', () => {
    const db = setup();
    seedUser(db, '919876543210');
    seedUser(db, '919999999999', { role: 'admin' });
    const id = seedComplaint(db, { phone: '919876543210', status: 'rejected' });

    const result = executeAdminCommand(
      db,
      'override-reject',
      `${id}: admin override reason`,
      '919999999999',
    );
    expect(result.response).toContain(id);
    expect(result.response).toContain('validated');

    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(id) as any;
    expect(complaint.status).toBe('validated');
  });

  it('creates validation record with admin_override action', () => {
    const db = setup();
    seedUser(db, '919876543210');
    seedUser(db, '919999999999', { role: 'admin' });
    const id = seedComplaint(db, { phone: '919876543210', status: 'rejected' });

    executeAdminCommand(
      db,
      'override-reject',
      `${id}: admin override reason`,
      '919999999999',
    );

    const validations = db
      .prepare('SELECT * FROM complaint_validations WHERE complaint_id = ?')
      .all(id) as any[];
    expect(validations).toHaveLength(1);
    expect(validations[0].action).toBe('admin_override');
    expect(validations[0].comment).toBe('admin override reason');
    expect(validations[0].validated_by).toBe('919999999999');
  });

  it('returns error for non-rejected complaint', () => {
    const db = setup();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, {
      phone: '919876543210',
      status: 'registered',
    });

    const result = executeAdminCommand(
      db,
      'override-reject',
      `${id}: reason`,
      '919999999999',
    );
    expect(result.response).toContain('not in rejected status');
  });

  it('returns error for non-existent complaint', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'override-reject',
      'RK-0000: reason',
      '919999999999',
    );
    expect(result.response).toContain('not found');
  });

  it('returns error when args missing', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'override-reject',
      '',
      '919999999999',
    );
    expect(result.response).toContain('Usage');
  });
});

describe('invalid command args', () => {
  it('returns helpful error for remove-karyakarta without phone', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'remove-karyakarta',
      '',
      '919999999999',
    );
    expect(result.response).toContain('Usage');
  });

  it('returns helpful error for assign-area without area', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'assign-area',
      '+919876543210',
      '919999999999',
    );
    expect(result.response).toContain('Usage');
  });

  it('returns helpful error for rename-area without new name', () => {
    const db = setup();
    const result = executeAdminCommand(
      db,
      'rename-area',
      'shivaji-nagar',
      '919999999999',
    );
    expect(result.response).toContain('Usage');
  });

  it('returns helpful error for remove-area without slug', () => {
    const db = setup();
    const result = executeAdminCommand(db, 'remove-area', '', '919999999999');
    expect(result.response).toContain('Usage');
  });
});
