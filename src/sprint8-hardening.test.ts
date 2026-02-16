/**
 * Sprint 8 P0 hardening tests — rate limiting, dual-secret rotation.
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  createGovTask,
  getGovTaskById,
} from './gov-db.js';
import { startOpsHttp } from './ops-http.js';
import { countDenials24h, getDenialsByCode24h } from './limits-db.js';

let server: http.Server;
let baseUrl: string;

const READ_SECRET = 'test-ops-secret-42';
const WRITE_CURRENT = 'write-secret-current-v2';
const WRITE_PREVIOUS = 'write-secret-previous-v1';

const now = new Date().toISOString();

// --- HTTP helpers ---

function post(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(payload)) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: { raw: data } as Record<string, unknown> });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: { raw: data } as Record<string, unknown> });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function seedTask(state = 'APPROVAL' as const) {
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Test Task',
    description: null,
    task_type: 'FEATURE',
    state,
    priority: 'P2',
    product: null,
    product_id: null,
    scope: 'COMPANY' as const,
    assigned_group: 'developer',
    executor: 'developer',
    created_by: 'main',
    gate: 'Security',
    dod_required: 0,
    metadata: null,
    created_at: now,
    updated_at: now,
  };
  createGovTask(task);
  return task;
}

describe('Sprint 8 P0 hardening', () => {
  beforeAll(async () => {
    process.env.OS_HTTP_SECRET = READ_SECRET;
    process.env.COCKPIT_WRITE_SECRET_CURRENT = WRITE_CURRENT;
    process.env.COCKPIT_WRITE_SECRET_PREVIOUS = WRITE_PREVIOUS;
    _initTestDatabase();
    server = startOpsHttp(0);
    await new Promise<void>((resolve) => {
      server.on('listening', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
    delete process.env.OS_HTTP_SECRET;
    delete process.env.COCKPIT_WRITE_SECRET_CURRENT;
    delete process.env.COCKPIT_WRITE_SECRET_PREVIOUS;
  });

  beforeEach(() => {
    _initTestDatabase();
  });

  // --- Dual-secret rotation ---

  describe('dual-secret rotation', () => {
    it('accepts CURRENT write secret', async () => {
      const task = seedTask();
      const res = await post('/ops/actions/transition', {
        taskId: task.id,
        toState: 'DONE',
      }, {
        'X-OS-SECRET': READ_SECRET,
        'X-WRITE-SECRET': WRITE_CURRENT,
        'Content-Type': 'application/json',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('accepts PREVIOUS write secret during rotation', async () => {
      const task = seedTask();
      const res = await post('/ops/actions/transition', {
        taskId: task.id,
        toState: 'DONE',
      }, {
        'X-OS-SECRET': READ_SECRET,
        'X-WRITE-SECRET': WRITE_PREVIOUS,
        'Content-Type': 'application/json',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('denies when neither CURRENT nor PREVIOUS matches', async () => {
      const res = await post('/ops/actions/transition', {
        taskId: 'some-task',
        toState: 'DONE',
      }, {
        'X-OS-SECRET': READ_SECRET,
        'X-WRITE-SECRET': 'completely-wrong-secret',
        'Content-Type': 'application/json',
      });
      expect(res.status).toBe(401);
    });

    it('denies when no write secret provided', async () => {
      const res = await post('/ops/actions/transition', {
        taskId: 'some-task',
        toState: 'DONE',
      }, {
        'X-OS-SECRET': READ_SECRET,
        'Content-Type': 'application/json',
      });
      expect(res.status).toBe(401);
    });
  });

  // --- Rate limiting ---

  describe('write action rate limiting', () => {
    it('allows requests within rate limit', async () => {
      const task = seedTask();
      const res = await post('/ops/actions/transition', {
        taskId: task.id,
        toState: 'DONE',
      }, {
        'X-OS-SECRET': READ_SECRET,
        'X-WRITE-SECRET': WRITE_CURRENT,
        'Content-Type': 'application/json',
      });
      expect(res.status).toBe(200);
    });

    it('returns 429 when rate limit exceeded', async () => {
      // Set very low rate limit
      process.env.RL_COCKPIT_WRITE_PER_MIN = '2';

      const headers = {
        'X-OS-SECRET': READ_SECRET,
        'X-WRITE-SECRET': WRITE_CURRENT,
        'Content-Type': 'application/json',
      };

      // First 2 requests succeed
      const task1 = seedTask();
      const res1 = await post('/ops/actions/transition', {
        taskId: task1.id, toState: 'DONE',
      }, headers);
      expect(res1.status).toBe(200);

      const task2 = seedTask();
      const res2 = await post('/ops/actions/transition', {
        taskId: task2.id, toState: 'DONE',
      }, headers);
      expect(res2.status).toBe(200);

      // 3rd request exceeds limit
      const task3 = seedTask();
      const res3 = await post('/ops/actions/transition', {
        taskId: task3.id, toState: 'DONE',
      }, headers);
      expect(res3.status).toBe(429);
      expect(res3.body.error).toBe('Rate limit exceeded');

      delete process.env.RL_COCKPIT_WRITE_PER_MIN;
    });

    it('rate limit denials appear in /ops/stats', async () => {
      // Set very low rate limit
      process.env.RL_COCKPIT_WRITE_PER_MIN = '1';

      const headers = {
        'X-OS-SECRET': READ_SECRET,
        'X-WRITE-SECRET': WRITE_CURRENT,
        'Content-Type': 'application/json',
      };

      // First request succeeds
      const task1 = seedTask();
      await post('/ops/actions/transition', {
        taskId: task1.id, toState: 'DONE',
      }, headers);

      // Second request triggers denial
      const task2 = seedTask();
      await post('/ops/actions/transition', {
        taskId: task2.id, toState: 'DONE',
      }, headers);

      // Check denial count
      const denials = countDenials24h();
      expect(denials).toBeGreaterThanOrEqual(1);

      const byCode = getDenialsByCode24h();
      const rateLimited = byCode.find((d) => d.code === 'RATE_LIMIT_EXCEEDED');
      expect(rateLimited).toBeDefined();
      expect(rateLimited!.count).toBeGreaterThanOrEqual(1);

      // Verify via /ops/stats
      const stats = await get('/ops/stats', { 'X-OS-SECRET': READ_SECRET });
      expect(stats.status).toBe(200);
      const limits = stats.body.limits as Record<string, unknown>;
      expect(limits.denials_24h).toBeGreaterThanOrEqual(1);

      delete process.env.RL_COCKPIT_WRITE_PER_MIN;
    });
  });
});
