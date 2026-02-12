import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import {
  generateSummaryData,
  formatSummaryMessage,
  runDailySummary,
} from './daily-summary.js';

// Create an in-memory DB with the complaint schema
function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE users (
      phone TEXT PRIMARY KEY,
      name TEXT,
      language TEXT DEFAULT 'mr',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      total_complaints INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      date_of_birth TEXT,
      block_reason TEXT,
      role TEXT DEFAULT 'user',
      blocked_until TEXT
    );

    CREATE TABLE complaints (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      description TEXT NOT NULL,
      location TEXT,
      language TEXT NOT NULL,
      status TEXT DEFAULT 'registered',
      status_reason TEXT,
      priority TEXT DEFAULT 'normal',
      source TEXT DEFAULT 'text',
      voice_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      days_open INTEGER DEFAULT 0,
      FOREIGN KEY (phone) REFERENCES users(phone)
    );
    CREATE INDEX idx_complaints_status ON complaints(status);
    CREATE INDEX idx_complaints_category ON complaints(category);
    CREATE INDEX idx_complaints_created ON complaints(created_at);

    CREATE TABLE categories (
      name TEXT PRIMARY KEY,
      display_name_en TEXT,
      display_name_mr TEXT,
      display_name_hi TEXT,
      complaint_count INTEGER DEFAULT 0,
      first_seen TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );
  `);

  return db;
}

function insertUser(db: Database.Database, phone: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO users (phone, name, first_seen, last_seen) VALUES (?, ?, ?, ?)`,
  ).run(phone, 'Test User', now, now);
}

function insertComplaint(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    phone: string;
    category: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
  }> = {},
): void {
  const id = overrides.id ?? `C-${Math.random().toString(36).slice(2, 8)}`;
  const phone = overrides.phone ?? '919999999999';
  const now = new Date().toISOString();

  insertUser(db, phone);

  db.prepare(
    `INSERT INTO complaints (id, phone, category, description, language, status, created_at, updated_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    phone,
    overrides.category ?? 'Water Supply',
    'Test complaint',
    'en',
    overrides.status ?? 'registered',
    overrides.created_at ?? now,
    now,
    overrides.resolved_at ?? null,
  );
}

// Helper to create ISO date string for N days ago
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// Helper for today's date string
function today(): string {
  return new Date().toISOString();
}

describe('generateSummaryData', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns zero counts when no complaints exist', () => {
    const data = generateSummaryData(db);
    expect(data.totalOpen).toBe(0);
    expect(data.newToday).toBe(0);
    expect(data.aging7).toBe(0);
    expect(data.aging14).toBe(0);
    expect(data.aging30).toBe(0);
    expect(data.pendingValidations).toBe(0);
    expect(data.byStatus).toEqual({});
    expect(data.topCategories).toEqual([]);
    expect(data.topAreas).toEqual([]);
  });

  it('counts open complaints correctly (excludes resolved)', () => {
    insertComplaint(db, { id: 'C-1', status: 'registered' });
    insertComplaint(db, { id: 'C-2', status: 'in_progress' });
    insertComplaint(db, {
      id: 'C-3',
      status: 'resolved',
      resolved_at: today(),
    });
    insertComplaint(db, { id: 'C-4', status: 'on_hold' });

    const data = generateSummaryData(db);
    expect(data.totalOpen).toBe(3);
  });

  it('breaks down open complaints by status', () => {
    insertComplaint(db, { id: 'C-1', status: 'registered' });
    insertComplaint(db, { id: 'C-2', status: 'registered' });
    insertComplaint(db, { id: 'C-3', status: 'in_progress' });
    insertComplaint(db, { id: 'C-4', status: 'on_hold' });
    insertComplaint(db, {
      id: 'C-5',
      status: 'resolved',
      resolved_at: today(),
    });

    const data = generateSummaryData(db);
    expect(data.byStatus).toEqual({
      registered: 2,
      in_progress: 1,
      on_hold: 1,
    });
  });

  it('counts new complaints created today', () => {
    insertComplaint(db, { id: 'C-1', created_at: today() });
    insertComplaint(db, { id: 'C-2', created_at: today() });
    insertComplaint(db, { id: 'C-3', created_at: daysAgo(2) });

    const data = generateSummaryData(db);
    expect(data.newToday).toBe(2);
  });

  it('identifies aging complaints > 7 days', () => {
    insertComplaint(db, {
      id: 'C-1',
      created_at: daysAgo(8),
      status: 'registered',
    });
    insertComplaint(db, {
      id: 'C-2',
      created_at: daysAgo(3),
      status: 'registered',
    });
    insertComplaint(db, {
      id: 'C-3',
      created_at: daysAgo(10),
      status: 'resolved',
      resolved_at: today(),
    });

    const data = generateSummaryData(db);
    expect(data.aging7).toBe(1);
  });

  it('identifies aging complaints > 14 days', () => {
    insertComplaint(db, {
      id: 'C-1',
      created_at: daysAgo(15),
      status: 'in_progress',
    });
    insertComplaint(db, {
      id: 'C-2',
      created_at: daysAgo(10),
      status: 'registered',
    });
    insertComplaint(db, {
      id: 'C-3',
      created_at: daysAgo(20),
      status: 'registered',
    });

    const data = generateSummaryData(db);
    expect(data.aging14).toBe(2);
  });

  it('identifies aging complaints > 30 days', () => {
    insertComplaint(db, {
      id: 'C-1',
      created_at: daysAgo(31),
      status: 'on_hold',
    });
    insertComplaint(db, {
      id: 'C-2',
      created_at: daysAgo(35),
      status: 'registered',
    });
    insertComplaint(db, {
      id: 'C-3',
      created_at: daysAgo(25),
      status: 'registered',
    });

    const data = generateSummaryData(db);
    expect(data.aging30).toBe(2);
  });

  it('lists top categories ordered by count (top 5)', () => {
    // Water Supply: 3, Roads: 2, Electricity: 1
    insertComplaint(db, { id: 'C-1', category: 'Water Supply' });
    insertComplaint(db, { id: 'C-2', category: 'Water Supply' });
    insertComplaint(db, { id: 'C-3', category: 'Water Supply' });
    insertComplaint(db, { id: 'C-4', category: 'Roads' });
    insertComplaint(db, { id: 'C-5', category: 'Roads' });
    insertComplaint(db, { id: 'C-6', category: 'Electricity' });

    const data = generateSummaryData(db);
    expect(data.topCategories).toEqual([
      { category: 'Water Supply', count: 3 },
      { category: 'Roads', count: 2 },
      { category: 'Electricity', count: 1 },
    ]);
  });

  it('limits top categories to 5', () => {
    const categories = ['Cat1', 'Cat2', 'Cat3', 'Cat4', 'Cat5', 'Cat6', 'Cat7'];
    categories.forEach((cat, i) => {
      for (let j = 0; j <= i; j++) {
        insertComplaint(db, { id: `C-${cat}-${j}`, category: cat });
      }
    });

    const data = generateSummaryData(db);
    expect(data.topCategories).toHaveLength(5);
    // Should be the top 5 by count (Cat7, Cat6, Cat5, Cat4, Cat3)
    expect(data.topCategories[0].category).toBe('Cat7');
  });

  it('counts pending validations', () => {
    insertComplaint(db, { id: 'C-1', status: 'pending_validation' });
    insertComplaint(db, { id: 'C-2', status: 'pending_validation' });
    insertComplaint(db, { id: 'C-3', status: 'registered' });

    const data = generateSummaryData(db);
    expect(data.pendingValidations).toBe(2);
  });

  it('returns empty topAreas when areas table does not exist', () => {
    insertComplaint(db, { id: 'C-1' });

    const data = generateSummaryData(db);
    expect(data.topAreas).toEqual([]);
  });

  it('returns topAreas when areas table exists with data', () => {
    // Create areas table and area_id column (simulating migration 004)
    db.exec(`
      CREATE TABLE areas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      ALTER TABLE complaints ADD COLUMN area_id TEXT;
    `);

    db.prepare(`INSERT INTO areas (id, name) VALUES (?, ?)`).run(
      'A1',
      'Shivajinagar',
    );
    db.prepare(`INSERT INTO areas (id, name) VALUES (?, ?)`).run(
      'A2',
      'Kothrud',
    );

    insertComplaint(db, { id: 'C-1' });
    insertComplaint(db, { id: 'C-2' });
    insertComplaint(db, { id: 'C-3' });

    db.prepare(`UPDATE complaints SET area_id = ? WHERE id = ?`).run(
      'A1',
      'C-1',
    );
    db.prepare(`UPDATE complaints SET area_id = ? WHERE id = ?`).run(
      'A1',
      'C-2',
    );
    db.prepare(`UPDATE complaints SET area_id = ? WHERE id = ?`).run(
      'A2',
      'C-3',
    );

    const data = generateSummaryData(db);
    expect(data.topAreas).toEqual([
      { area: 'Shivajinagar', count: 2 },
      { area: 'Kothrud', count: 1 },
    ]);
  });

  it('excludes resolved complaints from top categories', () => {
    insertComplaint(db, {
      id: 'C-1',
      category: 'Water Supply',
      status: 'resolved',
      resolved_at: today(),
    });
    insertComplaint(db, { id: 'C-2', category: 'Roads', status: 'registered' });

    const data = generateSummaryData(db);
    expect(data.topCategories).toEqual([{ category: 'Roads', count: 1 }]);
  });
});

describe('formatSummaryMessage', () => {
  it('formats "No open complaints." when totalOpen is 0', () => {
    const msg = formatSummaryMessage({
      totalOpen: 0,
      byStatus: {},
      newToday: 0,
      aging7: 0,
      aging14: 0,
      aging30: 0,
      topCategories: [],
      topAreas: [],
      pendingValidations: 0,
    });
    expect(msg).toBe('No open complaints.');
  });

  it('formats full summary with all sections', () => {
    const msg = formatSummaryMessage({
      totalOpen: 42,
      byStatus: { registered: 15, in_progress: 20, on_hold: 7 },
      newToday: 5,
      aging7: 12,
      aging14: 5,
      aging30: 2,
      topCategories: [
        { category: 'Water Supply', count: 15 },
        { category: 'Roads', count: 10 },
        { category: 'Electricity', count: 8 },
      ],
      topAreas: [],
      pendingValidations: 0,
    });

    expect(msg).toContain('Daily Complaint Summary');
    expect(msg).toContain('Open Complaints: 42');
    expect(msg).toContain('Registered: 15');
    expect(msg).toContain('In Progress: 20');
    expect(msg).toContain('On Hold: 7');
    expect(msg).toContain('New Today: 5');
    expect(msg).toContain('> 7 days: 12');
    expect(msg).toContain('> 14 days: 5');
    expect(msg).toContain('> 30 days: 2');
    expect(msg).toContain('Water Supply (15)');
    expect(msg).toContain('Roads (10)');
    expect(msg).toContain('Electricity (8)');
  });

  it('includes pending validations when > 0', () => {
    const msg = formatSummaryMessage({
      totalOpen: 10,
      byStatus: { registered: 5, pending_validation: 3, in_progress: 2 },
      newToday: 1,
      aging7: 0,
      aging14: 0,
      aging30: 0,
      topCategories: [],
      topAreas: [],
      pendingValidations: 3,
    });

    expect(msg).toContain('Pending Validation: 3');
  });

  it('does not include pending validations when 0', () => {
    const msg = formatSummaryMessage({
      totalOpen: 5,
      byStatus: { registered: 5 },
      newToday: 0,
      aging7: 0,
      aging14: 0,
      aging30: 0,
      topCategories: [],
      topAreas: [],
      pendingValidations: 0,
    });

    expect(msg).not.toContain('Pending Validation');
  });

  it('includes top areas when data exists', () => {
    const msg = formatSummaryMessage({
      totalOpen: 10,
      byStatus: { registered: 10 },
      newToday: 0,
      aging7: 0,
      aging14: 0,
      aging30: 0,
      topCategories: [],
      topAreas: [
        { area: 'Shivajinagar', count: 5 },
        { area: 'Kothrud', count: 3 },
      ],
      pendingValidations: 0,
    });

    expect(msg).toContain('Top Areas');
    expect(msg).toContain('Shivajinagar (5)');
    expect(msg).toContain('Kothrud (3)');
  });

  it('does not include top areas when empty', () => {
    const msg = formatSummaryMessage({
      totalOpen: 5,
      byStatus: { registered: 5 },
      newToday: 0,
      aging7: 0,
      aging14: 0,
      aging30: 0,
      topCategories: [],
      topAreas: [],
      pendingValidations: 0,
    });

    expect(msg).not.toContain('Top Areas');
  });

  it('formats status names with proper casing', () => {
    const msg = formatSummaryMessage({
      totalOpen: 10,
      byStatus: {
        pending_validation: 3,
        action_taken: 2,
        escalated_timeout: 5,
      },
      newToday: 0,
      aging7: 0,
      aging14: 0,
      aging30: 0,
      topCategories: [],
      topAreas: [],
      pendingValidations: 3,
    });

    expect(msg).toContain('Pending Validation: 3');
    expect(msg).toContain('Action Taken: 2');
    expect(msg).toContain('Escalated Timeout: 5');
  });
});

describe('runDailySummary', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('sends formatted summary to admin group JID', async () => {
    insertComplaint(db, { id: 'C-1', status: 'registered', category: 'Roads' });
    insertComplaint(db, {
      id: 'C-2',
      status: 'in_progress',
      category: 'Water Supply',
    });

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const adminJid = 'admin-group@g.us';

    await runDailySummary(db, sendMessage, adminJid);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      adminJid,
      expect.stringContaining('Open Complaints: 2'),
    );
  });

  it('sends "No open complaints." when DB is empty', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await runDailySummary(db, sendMessage, 'admin@g.us');

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      'admin@g.us',
      'No open complaints.',
    );
  });
});
