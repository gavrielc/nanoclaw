import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';

import { eventBus } from './event-bus.js';
import type { MlaEscalationDeps } from './mla-escalation.js';
import {
  escalateToMla,
  formatMlaEscalation,
  handleMlaReply,
} from './mla-escalation.js';
import { createTestDb, seedComplaint, seedUser } from './test-helpers.js';

function makeDeps(
  db: Database.Database,
  overrides?: Partial<MlaEscalationDeps>,
): MlaEscalationDeps {
  return {
    db,
    sendMessage: vi.fn(),
    adminGroupJid: '120363001234567890@g.us',
    mlaPhone: '919999000000',
    ...overrides,
  };
}

afterEach(() => {
  eventBus.removeAllListeners('complaint:status-changed');
});

// --- formatMlaEscalation ---

describe('formatMlaEscalation', () => {
  it('includes complaint ID, phone, category, description, location, and reason', () => {
    const result = formatMlaEscalation(
      {
        id: 'RK-20260212-0001',
        phone: '919876543210',
        category: 'water_supply',
        description: 'No water for 5 days in Ward 7',
        location: 'Ward 7',
        status: 'registered',
      },
      'Repeated complaint, needs MLA intervention',
    );

    expect(result).toContain('RK-20260212-0001');
    expect(result).toContain('919876543210');
    expect(result).toContain('water_supply');
    expect(result).toContain('No water for 5 days in Ward 7');
    expect(result).toContain('Ward 7');
    expect(result).toContain('Repeated complaint, needs MLA intervention');
    expect(result).toContain('Reply to this message');
  });

  it('handles null category and location gracefully', () => {
    const result = formatMlaEscalation(
      {
        id: 'RK-20260212-0002',
        phone: '919876543210',
        category: null,
        description: 'General complaint',
        location: null,
        status: 'registered',
      },
      'Urgent matter',
    );

    expect(result).toContain('RK-20260212-0002');
    expect(result).toContain('General complaint');
    expect(result).toContain('Urgent matter');
    // Should not crash or show "null"
    expect(result).not.toContain('null');
  });
});

// --- escalateToMla ---

describe('escalateToMla', () => {
  it('valid complaint: updates status to escalated and sends MLA DM', async () => {
    const db = createTestDb();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, {
      phone: '919876543210',
      category: 'water_supply',
    });

    const deps = makeDeps(db);
    const result = await escalateToMla(
      deps,
      id,
      'Needs MLA attention',
      '919999999999',
    );

    // Status updated
    const complaint = db
      .prepare('SELECT status FROM complaints WHERE id = ?')
      .get(id) as { status: string };
    expect(complaint.status).toBe('escalated');

    // MLA DM sent
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    const [jid, text] = (deps.sendMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(jid).toBe('919999000000@s.whatsapp.net');
    expect(text).toContain(id);
    expect(text).toContain('Needs MLA attention');

    // Success message returned
    expect(result).toContain(id);
    expect(result).toContain('escalated');
  });

  it('complaint not found returns error message', async () => {
    const db = createTestDb();
    const deps = makeDeps(db);

    const result = await escalateToMla(
      deps,
      'RK-NONEXIST-0000',
      'reason',
      '919999999999',
    );

    expect(result).toContain('not found');
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('emits complaint:status-changed event', async () => {
    const db = createTestDb();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, { phone: '919876543210' });

    const handler = vi.fn();
    eventBus.on('complaint:status-changed', handler);

    const deps = makeDeps(db);
    await escalateToMla(deps, id, 'Escalation reason', '919999999999');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        complaintId: id,
        oldStatus: 'registered',
        newStatus: 'escalated',
        updatedBy: '919999999999',
      }),
    );
  });

  it('creates complaint_updates audit record', async () => {
    const db = createTestDb();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, { phone: '919876543210' });

    const deps = makeDeps(db);
    await escalateToMla(deps, id, 'Audit test reason', '919999999999');

    const updates = db
      .prepare('SELECT * FROM complaint_updates WHERE complaint_id = ?')
      .all(id) as Array<{
      old_status: string;
      new_status: string;
      note: string;
      updated_by: string;
    }>;

    expect(updates).toHaveLength(1);
    expect(updates[0].old_status).toBe('registered');
    expect(updates[0].new_status).toBe('escalated');
    expect(updates[0].note).toContain('Audit test reason');
    expect(updates[0].updated_by).toBe('919999999999');
  });

  it('returns configuration error when mlaPhone is empty', async () => {
    const db = createTestDb();
    seedUser(db, '919876543210');
    const id = seedComplaint(db, { phone: '919876543210' });

    const deps = makeDeps(db, { mlaPhone: '' });
    const result = await escalateToMla(deps, id, 'reason', '919999999999');

    expect(result).toMatch(/config/i);
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });
});

// --- handleMlaReply ---

describe('handleMlaReply', () => {
  it('message from MLA phone is forwarded to admin group', async () => {
    const db = createTestDb();
    const deps = makeDeps(db);

    const result = await handleMlaReply(
      deps,
      '919999000000',
      'I will look into this matter immediately',
    );

    // Forward to admin group
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    const [jid, text] = (deps.sendMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(jid).toBe('120363001234567890@g.us');
    expect(text).toContain('I will look into this matter immediately');
    expect(text).toContain('MLA Reply');

    // Returns acknowledgment
    expect(result).toBeTruthy();
  });

  it('message from non-MLA phone returns null', async () => {
    const db = createTestDb();
    const deps = makeDeps(db);

    const result = await handleMlaReply(
      deps,
      '919876543210',
      'Some random message',
    );

    expect(result).toBeNull();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('returns acknowledgment to MLA', async () => {
    const db = createTestDb();
    const deps = makeDeps(db);

    const result = await handleMlaReply(
      deps,
      '919999000000',
      'Response to complaint',
    );

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});
