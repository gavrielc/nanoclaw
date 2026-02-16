/**
 * Sprint 7 tests — Embeddings pipeline, semantic recall, top_keys, /ops/memories/search.
 */
import http from 'http';
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { _initTestDatabase } from './db.js';
import { storeMemory, getMemoryById, countEmbeddings24h } from './memory-db.js';
import {
  embeddingToBuffer,
  cosineSimilarity,
  computeEmbedding,
} from './memory/embedding.js';
import { semanticRecall } from './memory/recall.js';
import {
  getTopQuotaUsedToday,
  getTopDenials24h,
  getTopExtCalls24h,
  getTopEmbeds24h,
} from './ops-metrics.js';
import { incrementQuota, logLimitDenial } from './limits-db.js';
import { logExtCall } from './ext-broker-db.js';
import { startOpsHttp } from './ops-http.js';

const now = new Date().toISOString();

// --- Stub vectors (3D for deterministic cosine similarity) ---
// query:  [1, 0, 0]
// vecA:   [1, 0, 0]  → cosine = 1.0  (identical)
// vecB:   [0.7071, 0.7071, 0] → cosine ≈ 0.7071  (45°)
// vecC:   [0, 1, 0]  → cosine = 0.0  (orthogonal)
const queryVec = new Float32Array([1, 0, 0]);
const vecA = new Float32Array([1, 0, 0]);
const vecB = new Float32Array([0.7071, 0.7071, 0]);
const vecC = new Float32Array([0, 1, 0]);

function makeMem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    content: 'test content',
    content_hash: 'hash1',
    level: 'L1' as const,
    scope: 'COMPANY',
    product_id: null,
    group_folder: 'developer',
    tags: null,
    pii_detected: 0,
    pii_types: null,
    source_type: 'agent',
    source_ref: null,
    policy_version: '1.1.0',
    embedding: null as Buffer | null,
    embedding_model: null as string | null,
    embedding_at: null as string | null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ----------------------------------------------------------------
// 1. Embedding storage: L0–L2 stored, L3 never
// ----------------------------------------------------------------

describe('embedding storage', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('stores embedding for L0 memory', () => {
    const buf = embeddingToBuffer(vecA);
    storeMemory(makeMem({ id: 'emb-l0', level: 'L0', embedding: buf, embedding_model: 'test', embedding_at: now }));
    const m = getMemoryById('emb-l0');
    expect(m).toBeDefined();
    expect(m!.embedding).not.toBeNull();
    expect(m!.embedding_model).toBe('test');
  });

  it('stores embedding for L1 memory', () => {
    const buf = embeddingToBuffer(vecB);
    storeMemory(makeMem({ id: 'emb-l1', level: 'L1', embedding: buf, embedding_model: 'test', embedding_at: now }));
    const m = getMemoryById('emb-l1');
    expect(m!.embedding).not.toBeNull();
  });

  it('stores embedding for L2 memory', () => {
    const buf = embeddingToBuffer(vecC);
    storeMemory(makeMem({ id: 'emb-l2', level: 'L2', embedding: buf, embedding_model: 'test', embedding_at: now }));
    const m = getMemoryById('emb-l2');
    expect(m!.embedding).not.toBeNull();
  });

  it('computeEmbedding returns null for L3 (never sent externally)', async () => {
    // Even if API key were set, L3 check happens first
    const result = await computeEmbedding('sensitive data', 'L3');
    expect(result).toBeNull();
  });

  it('L3 memory stored without embedding remains null', () => {
    storeMemory(makeMem({ id: 'emb-l3', level: 'L3', embedding: null }));
    const m = getMemoryById('emb-l3');
    expect(m!.embedding).toBeNull();
    expect(m!.embedding_model).toBeNull();
  });

  it('countEmbeddings24h counts recent embeddings', () => {
    storeMemory(makeMem({ id: 'cnt-1', embedding: embeddingToBuffer(vecA), embedding_model: 'test', embedding_at: now }));
    storeMemory(makeMem({ id: 'cnt-2', embedding: embeddingToBuffer(vecB), embedding_model: 'test', embedding_at: now }));
    storeMemory(makeMem({ id: 'cnt-3', embedding: null })); // no embedding
    expect(countEmbeddings24h()).toBe(2);
  });
});

// ----------------------------------------------------------------
// 2. Cosine similarity
// ----------------------------------------------------------------

describe('cosine similarity', () => {
  it('identical vectors → 1.0', () => {
    expect(cosineSimilarity(vecA, vecA)).toBeCloseTo(1.0, 5);
  });

  it('orthogonal vectors → 0.0', () => {
    expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0, 5);
  });

  it('45° vectors → ~0.7071', () => {
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.7071, 3);
  });

  it('different length vectors → 0', () => {
    const short = new Float32Array([1]);
    expect(cosineSimilarity(vecA, short)).toBe(0);
  });
});

// ----------------------------------------------------------------
// 3. Semantic recall with stub vectors
// ----------------------------------------------------------------

describe('semanticRecall', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('returns mode=semantic with cosine scores when embeddings present', () => {
    // Store 3 memories with embeddings
    storeMemory(makeMem({
      id: 'sem-a', content: 'exact match content',
      embedding: embeddingToBuffer(vecA), embedding_model: 'test', embedding_at: now,
    }));
    storeMemory(makeMem({
      id: 'sem-b', content: 'partial match content',
      embedding: embeddingToBuffer(vecB), embedding_model: 'test', embedding_at: now,
    }));
    storeMemory(makeMem({
      id: 'sem-c', content: 'no match content',
      embedding: embeddingToBuffer(vecC), embedding_model: 'test', embedding_at: now,
    }));

    const result = semanticRecall({
      queryEmbedding: queryVec,
      query: 'test',
      accessor_group: 'developer',
      accessor_is_main: false,
      product_id: null,
      limit: 10,
    });

    expect(result.mode).toBe('semantic');
    expect(result.memories.length).toBe(3);

    // Should be sorted by cosine similarity: A (1.0) > B (~0.71) > C (0.0)
    expect(result.memories[0].id).toBe('sem-a');
    expect(result.memories[0].score).toBeCloseTo(1.0, 3);
    expect(result.memories[1].id).toBe('sem-b');
    expect(result.memories[1].score).toBeCloseTo(0.7071, 2);
    expect(result.memories[2].id).toBe('sem-c');
    expect(result.memories[2].score).toBeCloseTo(0.0, 3);
  });

  it('falls back to keyword mode when queryEmbedding is null', () => {
    storeMemory(makeMem({
      id: 'kw-1', content: 'API design patterns for services',
      embedding: embeddingToBuffer(vecA), embedding_model: 'test', embedding_at: now,
    }));

    const result = semanticRecall({
      queryEmbedding: null,
      query: 'API design',
      accessor_group: 'developer',
      accessor_is_main: false,
      product_id: null,
    });

    expect(result.mode).toBe('keyword');
    expect(result.memories.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to keyword mode when no memories have embeddings', () => {
    storeMemory(makeMem({
      id: 'no-emb-1', content: 'fallback keyword content search',
      embedding: null,
    }));

    const result = semanticRecall({
      queryEmbedding: queryVec,
      query: 'fallback keyword content',
      accessor_group: 'developer',
      accessor_is_main: false,
      product_id: null,
    });

    expect(result.mode).toBe('keyword');
    expect(result.memories.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces access control in semantic mode', () => {
    // L2 memory by developer, queried by security (different group)
    storeMemory(makeMem({
      id: 'sec-1', content: 'developer secret data',
      level: 'L2', group_folder: 'developer',
      embedding: embeddingToBuffer(vecA), embedding_model: 'test', embedding_at: now,
    }));

    const result = semanticRecall({
      queryEmbedding: queryVec,
      query: 'secret',
      accessor_group: 'security',
      accessor_is_main: false,
      product_id: null,
    });

    // security can't see L2 developer memories (resolveMaxLevel → L0 for non-owner)
    expect(result.mode).toBe('semantic');
    expect(result.memories.length).toBe(0);
    expect(result.access_denials).toBe(1);
  });

  it('main can access all levels in semantic mode', () => {
    storeMemory(makeMem({
      id: 'main-1', content: 'internal data',
      level: 'L2', group_folder: 'developer',
      embedding: embeddingToBuffer(vecA), embedding_model: 'test', embedding_at: now,
    }));

    const result = semanticRecall({
      queryEmbedding: queryVec,
      query: 'internal',
      accessor_group: 'main',
      accessor_is_main: true,
      product_id: null,
    });

    expect(result.mode).toBe('semantic');
    expect(result.memories.length).toBe(1);
  });
});

// ----------------------------------------------------------------
// 4. Top keys metrics
// ----------------------------------------------------------------

describe('top_keys metrics', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('getTopQuotaUsedToday returns sorted by usage', () => {
    incrementQuota('ext_call', 'dev:github:L1', 500, 1000);
    incrementQuota('ext_call', 'dev:github:L1', 500, 1000);
    incrementQuota('ext_call', 'dev:github:L1', 500, 1000); // used=3
    incrementQuota('ext_call', 'sec:github:L1', 500, 1000); // used=1

    const result = getTopQuotaUsedToday();
    expect(result.length).toBe(2);
    expect(result[0].key).toBe('ext_call:dev:github:L1');
    expect(result[0].count).toBe(3);
    expect(result[1].key).toBe('ext_call:sec:github:L1');
    expect(result[1].count).toBe(1);
  });

  it('getTopDenials24h groups by op:scope_key', () => {
    logLimitDenial('ext_call', 'dev:github:L1', 'RATE_LIMIT');
    logLimitDenial('ext_call', 'dev:github:L1', 'RATE_LIMIT');
    logLimitDenial('embed', 'dev:openai', 'BREAKER_OPEN');

    const result = getTopDenials24h();
    expect(result.length).toBe(2);
    expect(result[0].key).toBe('ext_call:dev:github:L1');
    expect(result[0].count).toBe(2);
    expect(result[1].key).toBe('embed:dev:openai');
    expect(result[1].count).toBe(1);
  });

  it('getTopExtCalls24h groups by group:provider:level', () => {
    logExtCall({
      request_id: 'ext-1',
      group_folder: 'developer',
      provider: 'github',
      action: 'repo.list',
      access_level: 1,
      params_hmac: 'hmac',
      params_summary: null,
      status: 'executed',
      denial_reason: null,
      result_summary: null,
      response_data: null,
      task_id: null,
      idempotency_key: null,
      duration_ms: 50,
      created_at: now,
    });
    logExtCall({
      request_id: 'ext-2',
      group_folder: 'developer',
      provider: 'github',
      action: 'repo.get',
      access_level: 1,
      params_hmac: 'hmac',
      params_summary: null,
      status: 'executed',
      denial_reason: null,
      result_summary: null,
      response_data: null,
      task_id: null,
      idempotency_key: null,
      duration_ms: 30,
      created_at: now,
    });

    const result = getTopExtCalls24h();
    expect(result.length).toBe(1);
    expect(result[0].key).toBe('developer:github:L1');
    expect(result[0].count).toBe(2);
  });

  it('getTopEmbeds24h groups by group:model', () => {
    storeMemory(makeMem({
      id: 'tk-e1', group_folder: 'developer',
      embedding: embeddingToBuffer(vecA), embedding_model: 'text-embedding-3-small', embedding_at: now,
    }));
    storeMemory(makeMem({
      id: 'tk-e2', group_folder: 'developer',
      embedding: embeddingToBuffer(vecB), embedding_model: 'text-embedding-3-small', embedding_at: now,
    }));

    const result = getTopEmbeds24h();
    expect(result.length).toBe(1);
    expect(result[0].key).toBe('developer:text-embedding-3-small');
    expect(result[0].count).toBe(2);
  });

  it('top_keys returns empty arrays when no data', () => {
    expect(getTopQuotaUsedToday()).toEqual([]);
    expect(getTopDenials24h()).toEqual([]);
    expect(getTopExtCalls24h()).toEqual([]);
    expect(getTopEmbeds24h()).toEqual([]);
  });

  it('top_keys respects limit parameter', () => {
    for (let i = 0; i < 15; i++) {
      incrementQuota('ext_call', `grp${i}:github:L1`, 500, 1000);
    }
    const result = getTopQuotaUsedToday(5);
    expect(result.length).toBe(5);
  });
});

// ----------------------------------------------------------------
// 5. /ops/memories/search endpoint
// ----------------------------------------------------------------

describe('/ops/memories/search endpoint', () => {
  let server: http.Server;
  let baseUrl: string;

  const SECRET = 'test-sprint7-secret';
  const AUTH = { 'X-OS-SECRET': SECRET };

  function get(
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, { method: 'GET', headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  beforeAll(() => {
    process.env.OS_HTTP_SECRET = SECRET;
    _initTestDatabase();

    // Seed memories with embeddings
    storeMemory(makeMem({
      id: 'http-sem-1', content: 'API endpoint documentation',
      embedding: embeddingToBuffer(vecA), embedding_model: 'test', embedding_at: now,
    }));
    storeMemory(makeMem({
      id: 'http-sem-2', content: 'Database schema reference',
      embedding: embeddingToBuffer(vecB), embedding_model: 'test', embedding_at: now,
    }));

    return new Promise<void>((resolve) => {
      server = startOpsHttp(0);
      server.on('listening', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('returns keyword mode when no OPENAI_API_KEY set', async () => {
    // No OPENAI_API_KEY → computeEmbedding returns null → keyword fallback
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBEDDING_API_KEY;

    const { status, body } = await get('/ops/memories/search?q=API+endpoint', AUTH);
    expect(status).toBe(200);
    const data = body as { mode: string; memories: unknown[]; total_considered: number };
    expect(data.mode).toBe('keyword');
    expect(Array.isArray(data.memories)).toBe(true);
  });

  it('returns 400 without q parameter', async () => {
    const { status } = await get('/ops/memories/search', AUTH);
    expect(status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const { status } = await get('/ops/memories/search?q=test');
    expect(status).toBe(401);
  });

  it('does not include embedding BLOB in response', async () => {
    const { status, body } = await get('/ops/memories/search?q=API', AUTH);
    expect(status).toBe(200);
    const data = body as { memories: Array<Record<string, unknown>> };
    for (const mem of data.memories) {
      expect(mem).not.toHaveProperty('embedding');
    }
  });

  it('GET /ops/stats includes top_keys section', async () => {
    const { status, body } = await get('/ops/stats', AUTH);
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data).toHaveProperty('top_keys');
    const tk = data.top_keys as Record<string, unknown[]>;
    expect(tk).toHaveProperty('quota_used_today');
    expect(tk).toHaveProperty('denials_24h');
    expect(tk).toHaveProperty('ext_calls_24h');
    expect(tk).toHaveProperty('embeds_24h');
    expect(Array.isArray(tk.quota_used_today)).toBe(true);
  });

  it('GET /ops/memories does not include embedding BLOBs', async () => {
    const { status, body } = await get('/ops/memories?q=API', AUTH);
    expect(status).toBe(200);
    const data = body as Array<Record<string, unknown>>;
    for (const mem of data) {
      expect(mem).not.toHaveProperty('embedding');
    }
  });
});
