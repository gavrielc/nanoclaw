import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import {
  logUsage,
  getUsageStats,
  formatUsageSection,
} from './usage-monitor.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      complaint_id TEXT,
      model TEXT NOT NULL,
      purpose TEXT,
      container_duration_ms INTEGER,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('logUsage', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-12T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates record in usage_log with correct fields', () => {
    logUsage(db, {
      phone: '919876543210',
      complaint_id: 'RK-20260212-0001',
      model: 'sonnet-4.5',
      purpose: 'complaint_response',
      container_duration_ms: 1500,
    });

    const row = db
      .prepare('SELECT * FROM usage_log WHERE id = 1')
      .get() as Record<string, unknown>;
    expect(row.phone).toBe('919876543210');
    expect(row.complaint_id).toBe('RK-20260212-0001');
    expect(row.model).toBe('sonnet-4.5');
    expect(row.purpose).toBe('complaint_response');
    expect(row.container_duration_ms).toBe(1500);
  });

  it('sets created_at to current ISO timestamp', () => {
    logUsage(db, { model: 'sonnet-4.5', purpose: 'test' });

    const row = db
      .prepare('SELECT created_at FROM usage_log WHERE id = 1')
      .get() as { created_at: string };
    expect(row.created_at).toBe('2026-02-12T10:30:00.000Z');
  });

  it('allows optional fields to be undefined', () => {
    logUsage(db, { model: 'opus-4.6', purpose: 'analysis' });

    const row = db
      .prepare('SELECT * FROM usage_log WHERE id = 1')
      .get() as Record<string, unknown>;
    expect(row.phone).toBeNull();
    expect(row.complaint_id).toBeNull();
    expect(row.container_duration_ms).toBeNull();
  });

  it('logs multiple entries independently', () => {
    logUsage(db, { model: 'sonnet-4.5', purpose: 'response' });
    logUsage(db, { model: 'opus-4.6', purpose: 'analysis' });
    logUsage(db, { model: 'sonnet-4.5', purpose: 'response' });

    const count = db.prepare('SELECT COUNT(*) as c FROM usage_log').get() as {
      c: number;
    };
    expect(count.c).toBe(3);
  });
});

describe('getUsageStats', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  function insertEntry(
    overrides: {
      model?: string;
      container_duration_ms?: number | null;
      created_at?: string;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO usage_log (phone, model, purpose, container_duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      '919876543210',
      overrides.model ?? 'sonnet-4.5',
      'test',
      overrides.container_duration_ms === null
        ? null
        : (overrides.container_duration_ms ?? null),
      overrides.created_at ?? '2026-02-12T10:00:00.000Z',
    );
  }

  it('returns correct totalMessages for date', () => {
    insertEntry({ created_at: '2026-02-12T08:00:00.000Z' });
    insertEntry({ created_at: '2026-02-12T14:00:00.000Z' });
    insertEntry({ created_at: '2026-02-11T23:59:59.000Z' }); // different day

    const stats = getUsageStats(db, '2026-02-12');
    expect(stats.totalMessages).toBe(2);
  });

  it('returns correct containerRuns', () => {
    insertEntry({ container_duration_ms: 1500 });
    insertEntry({ container_duration_ms: 2000 });
    insertEntry({ container_duration_ms: null }); // no container

    const stats = getUsageStats(db, '2026-02-12');
    expect(stats.containerRuns).toBe(2);
  });

  it('returns correct avgDurationMs', () => {
    insertEntry({ container_duration_ms: 1000 });
    insertEntry({ container_duration_ms: 3000 });
    insertEntry({ container_duration_ms: null }); // excluded from avg

    const stats = getUsageStats(db, '2026-02-12');
    expect(stats.avgDurationMs).toBe(2000);
  });

  it('distinguishes Sonnet vs Opus in byModel', () => {
    insertEntry({ model: 'sonnet-4.5' });
    insertEntry({ model: 'sonnet-4.5' });
    insertEntry({ model: 'sonnet-4.5' });
    insertEntry({ model: 'opus-4.6' });

    const stats = getUsageStats(db, '2026-02-12');
    expect(stats.byModel).toEqual({
      'sonnet-4.5': 3,
      'opus-4.6': 1,
    });
  });

  it('returns zeros for date with no entries', () => {
    const stats = getUsageStats(db, '2026-02-12');
    expect(stats.totalMessages).toBe(0);
    expect(stats.containerRuns).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.byModel).toEqual({});
  });
});

describe('formatUsageSection', () => {
  it('formats correctly with data', () => {
    const text = formatUsageSection({
      totalMessages: 42,
      containerRuns: 38,
      avgDurationMs: 2300,
      byModel: { 'Sonnet 4.5': 35, 'Opus 4.6': 3 },
    });

    expect(text).toContain('Usage');
    expect(text).toContain('Messages: 42');
    expect(text).toContain('Agent Runs: 38');
    expect(text).toContain('Avg Duration: 2.3s');
    expect(text).toContain('Sonnet 4.5 (35)');
    expect(text).toContain('Opus 4.6 (3)');
  });

  it('handles zero container runs (no avg duration line)', () => {
    const text = formatUsageSection({
      totalMessages: 5,
      containerRuns: 0,
      avgDurationMs: 0,
      byModel: { 'sonnet-4.5': 5 },
    });

    expect(text).toContain('Messages: 5');
    expect(text).toContain('Agent Runs: 0');
    expect(text).not.toContain('Avg Duration');
  });

  it('formats duration with one decimal place', () => {
    const text = formatUsageSection({
      totalMessages: 10,
      containerRuns: 5,
      avgDurationMs: 1234,
      byModel: { 'sonnet-4.5': 10 },
    });

    expect(text).toContain('Avg Duration: 1.2s');
  });

  it('formats models section with all models', () => {
    const text = formatUsageSection({
      totalMessages: 3,
      containerRuns: 1,
      avgDurationMs: 500,
      byModel: { 'model-a': 1, 'model-b': 1, 'model-c': 1 },
    });

    expect(text).toContain('model-a (1)');
    expect(text).toContain('model-b (1)');
    expect(text).toContain('model-c (1)');
  });
});
