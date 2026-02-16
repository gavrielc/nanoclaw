import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from '../db.js';
import { storeMemory, getMemoryAccessLog } from '../memory-db.js';
import { recallRelevantMemory, resolveMaxLevel } from './recall.js';
import type { Memory } from './constants.js';

const now = new Date().toISOString();

function mem(overrides: Partial<Omit<Memory, 'version'>>): Omit<Memory, 'version'> {
  return {
    id: 'mem-1',
    content: 'test content',
    content_hash: 'hash1',
    level: 'L1',
    scope: 'COMPANY',
    product_id: null,
    group_folder: 'developer',
    tags: null,
    pii_detected: 0,
    pii_types: null,
    source_type: 'agent',
    source_ref: null,
    policy_version: '1.0.0',
    embedding: null,
    embedding_model: null,
    embedding_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('resolveMaxLevel', () => {
  it('main can see up to L3', () => {
    expect(resolveMaxLevel('main', true, 'developer', 'COMPANY', null, null)).toBe('L3');
  });

  it('owner group sees up to L2', () => {
    expect(resolveMaxLevel('developer', false, 'developer', 'COMPANY', null, null)).toBe('L2');
  });

  it('same product different group sees up to L1', () => {
    expect(resolveMaxLevel('security', false, 'developer', 'PRODUCT', 'ritmo', 'ritmo')).toBe('L1');
  });

  it('different group and product sees only L0', () => {
    expect(resolveMaxLevel('security', false, 'developer', 'PRODUCT', 'ritmo', 'other')).toBe('L0');
  });
});

describe('recallRelevantMemory', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('L0 memories are visible to all groups', () => {
    storeMemory(mem({ id: 'pub-1', content: 'public knowledge API docs', level: 'L0' }));
    const result = recallRelevantMemory({
      query: 'API docs',
      accessor_group: 'security',
      accessor_is_main: false,
      scope: 'COMPANY',
      product_id: null,
    });
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].id).toBe('pub-1');
  });

  it('L1 memories visible to owner group but not others', () => {
    storeMemory(mem({ id: 'op-1', content: 'developer operational notes', level: 'L1', group_folder: 'developer' }));

    // Owner sees it
    const devResult = recallRelevantMemory({
      query: 'operational notes',
      accessor_group: 'developer',
      accessor_is_main: false,
      scope: 'COMPANY',
      product_id: null,
    });
    expect(devResult.memories).toHaveLength(1);

    // Other group doesn't see it
    const secResult = recallRelevantMemory({
      query: 'operational notes',
      accessor_group: 'security',
      accessor_is_main: false,
      scope: 'COMPANY',
      product_id: null,
    });
    expect(secResult.memories).toHaveLength(0);
    expect(secResult.access_denials).toBe(1);
  });

  it('L2 product-scoped memories enforce product isolation', () => {
    storeMemory(mem({
      id: 'prod-1',
      content: 'product strategy details',
      level: 'L2',
      scope: 'PRODUCT',
      product_id: 'ritmo',
      group_folder: 'developer',
    }));

    // Same product can see
    const sameProduct = recallRelevantMemory({
      query: 'product strategy',
      accessor_group: 'developer',
      accessor_is_main: false,
      scope: 'PRODUCT',
      product_id: 'ritmo',
    });
    expect(sameProduct.memories).toHaveLength(1);

    // Different product cannot see
    const diffProduct = recallRelevantMemory({
      query: 'product strategy',
      accessor_group: 'developer',
      accessor_is_main: false,
      scope: 'PRODUCT',
      product_id: 'other',
    });
    expect(diffProduct.memories).toHaveLength(0);
    expect(diffProduct.access_denials).toBe(1);
  });

  it('L3 memories visible only to main, with audit log', () => {
    storeMemory(mem({ id: 'secret-1', content: 'sensitive credentials data', level: 'L3' }));

    // Non-main denied + audited
    const nonMain = recallRelevantMemory({
      query: 'sensitive credentials',
      accessor_group: 'developer',
      accessor_is_main: false,
      scope: 'COMPANY',
      product_id: null,
    });
    expect(nonMain.memories).toHaveLength(0);
    expect(nonMain.access_denials).toBe(1);

    // Verify audit log
    const logs = getMemoryAccessLog('secret-1');
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].granted).toBe(0);
    expect(logs[0].reason).toBe('L3_ACCESS_DENIED');

    // Main can see + audited
    const mainResult = recallRelevantMemory({
      query: 'sensitive credentials',
      accessor_group: 'main',
      accessor_is_main: true,
      scope: 'COMPANY',
      product_id: null,
    });
    expect(mainResult.memories).toHaveLength(1);
    const mainLogs = getMemoryAccessLog('secret-1');
    expect(mainLogs.length).toBeGreaterThanOrEqual(2);
    // Most recent log should be granted
    expect(mainLogs[0].granted).toBe(1);
  });

  it('scores results by keyword match count', () => {
    storeMemory(mem({ id: 'rank-1', content: 'revenue growth performance' }));
    storeMemory(mem({ id: 'rank-2', content: 'revenue analysis growth metrics performance boost' }));

    const result = recallRelevantMemory({
      query: 'revenue growth performance metrics',
      accessor_group: 'developer',
      accessor_is_main: false,
      scope: 'COMPANY',
      product_id: null,
    });
    // rank-2 should score higher (more keyword matches)
    expect(result.memories.length).toBe(2);
    expect(result.memories[0].id).toBe('rank-2');
    expect(result.memories[0].score).toBeGreaterThan(result.memories[1].score);
  });

  it('counts access denials correctly', () => {
    storeMemory(mem({ id: 'l1-1', content: 'dev notes alpha', level: 'L1', group_folder: 'developer' }));
    storeMemory(mem({ id: 'l1-2', content: 'dev notes beta', level: 'L1', group_folder: 'developer' }));
    storeMemory(mem({ id: 'l0-1', content: 'public notes alpha', level: 'L0', group_folder: 'developer' }));

    const result = recallRelevantMemory({
      query: 'notes alpha beta',
      accessor_group: 'security',
      accessor_is_main: false,
      scope: 'COMPANY',
      product_id: null,
    });
    // security can see L0 but not L1 developer memories
    expect(result.memories).toHaveLength(1);
    expect(result.access_denials).toBe(2);
  });
});
