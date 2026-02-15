import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  storeMemory,
  getMemoryById,
  getMemoriesByGroup,
  getMemoriesByProduct,
  searchMemoriesByKeywords,
  updateMemory,
  deleteMemory,
  logMemoryAccess,
  getMemoryAccessLog,
  countL3AccessesSince,
} from './memory-db.js';

function makeMemory(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: 'mem-1',
    content: 'Test memory content',
    content_hash: 'abc123hash',
    level: 'L1' as const,
    scope: 'COMPANY',
    product_id: null,
    group_folder: 'developer',
    tags: null,
    pii_detected: 0,
    pii_types: null,
    source_type: 'agent',
    source_ref: null,
    policy_version: '1.0.0',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('memory-db', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('stores and retrieves a memory', () => {
    storeMemory(makeMemory());
    const mem = getMemoryById('mem-1');
    expect(mem).toBeDefined();
    expect(mem!.content).toBe('Test memory content');
    expect(mem!.level).toBe('L1');
    expect(mem!.version).toBe(0);
  });

  it('upserts on conflict (preserves created_at)', () => {
    const first = makeMemory({ created_at: '2026-01-01T00:00:00Z' });
    storeMemory(first);
    const updated = makeMemory({
      content: 'Updated content',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    });
    storeMemory(updated);
    const mem = getMemoryById('mem-1');
    expect(mem!.content).toBe('Updated content');
    // created_at preserved from first insert (ON CONFLICT DO UPDATE doesn't touch it)
    expect(mem!.created_at).toBe('2026-01-01T00:00:00Z');
  });

  it('lists memories by group', () => {
    storeMemory(makeMemory({ id: 'mem-1', group_folder: 'developer' }));
    storeMemory(makeMemory({ id: 'mem-2', group_folder: 'developer' }));
    storeMemory(makeMemory({ id: 'mem-3', group_folder: 'security' }));

    const devMems = getMemoriesByGroup('developer');
    expect(devMems).toHaveLength(2);
    const secMems = getMemoriesByGroup('security');
    expect(secMems).toHaveLength(1);
  });

  it('lists memories by product with level ceiling', () => {
    storeMemory(
      makeMemory({ id: 'mem-1', product_id: 'ritmo', level: 'L0' }),
    );
    storeMemory(
      makeMemory({ id: 'mem-2', product_id: 'ritmo', level: 'L2' }),
    );
    storeMemory(
      makeMemory({ id: 'mem-3', product_id: 'ritmo', level: 'L3' }),
    );

    const upToL2 = getMemoriesByProduct('ritmo', 'L2');
    expect(upToL2).toHaveLength(2);
    const upToL3 = getMemoriesByProduct('ritmo', 'L3');
    expect(upToL3).toHaveLength(3);
  });

  it('searches by keywords with LIKE', () => {
    storeMemory(
      makeMemory({ id: 'mem-1', content: 'Revenue growth report Q1' }),
    );
    storeMemory(
      makeMemory({ id: 'mem-2', content: 'Security audit findings' }),
    );
    storeMemory(
      makeMemory({
        id: 'mem-3',
        content: 'Revenue projections Q2',
      }),
    );

    const results = searchMemoriesByKeywords(['Revenue'], {});
    expect(results).toHaveLength(2);
  });

  it('keyword search respects product isolation', () => {
    storeMemory(
      makeMemory({
        id: 'mem-1',
        content: 'API design',
        product_id: 'ritmo',
        scope: 'PRODUCT',
      }),
    );
    storeMemory(
      makeMemory({
        id: 'mem-2',
        content: 'API security',
        product_id: 'other',
        scope: 'PRODUCT',
      }),
    );

    const results = searchMemoriesByKeywords(['API'], {
      productId: 'ritmo',
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('mem-1');
  });

  it('optimistic locking prevents stale updates', () => {
    storeMemory(makeMemory());
    // First update succeeds (version 0 → 1)
    const ok = updateMemory('mem-1', 0, { content: 'Updated' });
    expect(ok).toBe(true);
    const mem = getMemoryById('mem-1');
    expect(mem!.version).toBe(1);
    expect(mem!.content).toBe('Updated');

    // Second update with stale version 0 fails
    const stale = updateMemory('mem-1', 0, { content: 'Stale' });
    expect(stale).toBe(false);
    // Content unchanged
    expect(getMemoryById('mem-1')!.content).toBe('Updated');
  });

  it('deletes a memory', () => {
    storeMemory(makeMemory());
    expect(getMemoryById('mem-1')).toBeDefined();
    const ok = deleteMemory('mem-1');
    expect(ok).toBe(true);
    expect(getMemoryById('mem-1')).toBeUndefined();
  });

  it('delete returns false for non-existent memory', () => {
    expect(deleteMemory('nonexistent')).toBe(false);
  });

  it('logs and retrieves memory access entries', () => {
    storeMemory(makeMemory());
    const now = new Date().toISOString();
    logMemoryAccess({
      memory_id: 'mem-1',
      accessor_group: 'security',
      access_type: 'recall',
      granted: 1,
      reason: null,
      created_at: now,
    });
    logMemoryAccess({
      memory_id: 'mem-1',
      accessor_group: 'developer',
      access_type: 'search',
      granted: 0,
      reason: 'L3_ACCESS_DENIED',
      created_at: now,
    });

    const logs = getMemoryAccessLog('mem-1');
    expect(logs).toHaveLength(2);
  });

  it('counts accesses since timestamp', () => {
    const old = '2026-01-01T00:00:00Z';
    const recent = '2026-02-15T12:00:00Z';
    logMemoryAccess({
      memory_id: 'mem-1',
      accessor_group: 'security',
      access_type: 'recall',
      granted: 1,
      reason: null,
      created_at: old,
    });
    logMemoryAccess({
      memory_id: 'mem-1',
      accessor_group: 'security',
      access_type: 'search',
      granted: 1,
      reason: null,
      created_at: recent,
    });

    const count = countL3AccessesSince('security', '2026-02-01T00:00:00Z');
    expect(count).toBe(1);
  });

  it('returns empty arrays for no matches', () => {
    expect(getMemoriesByGroup('nonexistent')).toEqual([]);
    expect(getMemoriesByProduct('nonexistent', 'L3')).toEqual([]);
    expect(searchMemoriesByKeywords(['nothing'], {})).toEqual([]);
    expect(getMemoryAccessLog('nonexistent')).toEqual([]);
  });
});
