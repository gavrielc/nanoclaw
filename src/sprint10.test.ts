/**
 * Sprint 10 tests — SSE EventBus, worker read endpoints, sanitization.
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import { createGovTask, tryCreateDispatch } from './gov-db.js';
import { upsertWorker } from './worker-db.js';
import type { Worker } from './worker-db.js';
import { startOpsHttp } from './ops-http.js';
import { emitOpsEvent, shutdownSse } from './ops-events.js';

let server: http.Server;
let baseUrl: string;

const SECRET = 'test-ops-secret-sprint10';
const AUTH = { 'X-OS-SECRET': SECRET };

const now = new Date().toISOString();

function makeWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: 'worker-1',
    ssh_host: '10.0.0.2',
    ssh_user: 'deploy',
    ssh_port: 22,
    local_port: 7810,
    remote_port: 7801,
    status: 'online',
    max_wip: 2,
    current_wip: 1,
    shared_secret: 'super-secret-hmac-key',
    callback_url: 'http://10.0.0.1:7700',
    ssh_identity_file: '/root/.ssh/nanoclaw_worker',
    groups_json: '["developer","security"]',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

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

function seedData(): void {
  upsertWorker(makeWorker({ id: 'worker-1' }));
  upsertWorker(makeWorker({
    id: 'worker-2',
    ssh_host: '10.0.0.3',
    local_port: 7811,
    status: 'offline',
    groups_json: '["security"]',
  }));

  createGovTask({
    id: 'task-w1',
    title: 'Worker dispatch test',
    description: 'Test task',
    task_type: 'FEATURE',
    state: 'DOING',
    priority: 'P2',
    product: null,
    product_id: null,
    scope: 'COMPANY',
    assigned_group: 'developer',
    executor: null,
    created_by: 'main',
    gate: 'None',
    dod_required: 0,
    metadata: null,
    created_at: now,
    updated_at: now,
  });

  tryCreateDispatch({
    task_id: 'task-w1',
    from_state: 'READY',
    to_state: 'DOING',
    dispatch_key: 'task-w1:READY->DOING:v0',
    group_jid: 'developer@jid',
    worker_id: 'worker-1',
    status: 'STARTED',
    created_at: now,
    updated_at: now,
  });
}

beforeAll(() => {
  process.env.OS_HTTP_SECRET = SECRET;
  _initTestDatabase();
  seedData();

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
  shutdownSse();
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// --- Worker Read Endpoints ---

describe('worker read endpoints', () => {
  it('GET /ops/workers returns list without secrets', async () => {
    const { status, body } = await get('/ops/workers', AUTH);
    expect(status).toBe(200);
    const workers = body as Array<Record<string, unknown>>;
    expect(workers.length).toBe(2);

    const w1 = workers.find((w) => w.id === 'worker-1')!;
    expect(w1.status).toBe('online');
    expect(w1.current_wip).toBe(1);
    expect(w1.groups_json).toBe('["developer","security"]');

    // Sanitization: no secrets
    expect(w1).not.toHaveProperty('shared_secret');
    expect(w1).not.toHaveProperty('ssh_identity_file');
  });

  it('GET /ops/workers/:id returns single worker', async () => {
    const { status, body } = await get('/ops/workers/worker-1', AUTH);
    expect(status).toBe(200);
    const w = body as Record<string, unknown>;
    expect(w.id).toBe('worker-1');
    expect(w.ssh_host).toBe('10.0.0.2');

    // Sanitization
    expect(w).not.toHaveProperty('shared_secret');
    expect(w).not.toHaveProperty('ssh_identity_file');
  });

  it('GET /ops/workers/:id returns 404 for missing worker', async () => {
    const { status } = await get('/ops/workers/nonexistent', AUTH);
    expect(status).toBe(404);
  });

  it('GET /ops/workers/:id/dispatches returns recent dispatches', async () => {
    const { status, body } = await get('/ops/workers/worker-1/dispatches', AUTH);
    expect(status).toBe(200);
    const dispatches = body as Array<Record<string, unknown>>;
    expect(dispatches.length).toBeGreaterThanOrEqual(1);
    expect(dispatches[0].worker_id).toBe('worker-1');
    expect(dispatches[0].task_id).toBe('task-w1');
  });

  it('GET /ops/workers/:id/tunnels returns tunnel info', async () => {
    const { status, body } = await get('/ops/workers/worker-1/tunnels', AUTH);
    expect(status).toBe(200);
    const t = body as Record<string, unknown>;
    expect(t.worker_id).toBe('worker-1');
    expect(typeof t.tunnel_up).toBe('boolean');
    expect(t.local_port).toBe(7810);
  });

  it('worker endpoints require auth', async () => {
    const { status } = await get('/ops/workers');
    expect(status).toBe(401);
  });
});

// --- SSE Auth ---

describe('SSE endpoint', () => {
  it('GET /ops/events requires auth', async () => {
    const { status } = await get('/ops/events');
    expect(status).toBe(401);
  });

  it('GET /ops/events returns text/event-stream with auth', () => {
    return new Promise<void>((resolve) => {
      const url = new URL('/ops/events', baseUrl);
      const req = http.request(url, { method: 'GET', headers: AUTH }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        expect(res.headers['cache-control']).toBe('no-cache');

        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
          if (data.includes('event: connected')) {
            res.destroy();
            resolve();
          }
        });
      });
      req.on('error', () => { /* expected on destroy */ });
      req.end();
    });
  });

  it('SSE emits events to connected clients', () => {
    return new Promise<void>((resolve) => {
      const url = new URL('/ops/events', baseUrl);
      const req = http.request(url, { method: 'GET', headers: AUTH }, (res) => {
        let buffer = '';
        let gotConnected = false;

        res.on('data', (chunk) => {
          buffer += chunk.toString();

          if (!gotConnected && buffer.includes('event: connected')) {
            gotConnected = true;
            emitOpsEvent('worker:status', {
              workerId: 'worker-1',
              status: 'offline',
            });
          }

          if (gotConnected && buffer.includes('event: worker:status')) {
            expect(buffer).toContain('"workerId":"worker-1"');
            expect(buffer).toContain('"status":"offline"');
            res.destroy();
            resolve();
          }
        });
      });
      req.on('error', () => { /* expected on destroy */ });
      req.end();
    });
  });
});

// --- Sanitization ---

describe('SSE sanitization', () => {
  it('emitted events strip forbidden keys', () => {
    // We test this by capturing the event output format
    // The sanitize function removes secret/token/password fields
    const events: string[] = [];
    const url = new URL('/ops/events', baseUrl);

    return new Promise<void>((resolve, reject) => {
      const req = http.request(url, { method: 'GET', headers: AUTH }, (res) => {
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();

          if (buffer.includes('event: connected') && !buffer.includes('event: worker:status')) {
            // Emit event with secret data
            emitOpsEvent('worker:status', {
              workerId: 'worker-test',
              status: 'online',
              shared_secret: 'should-be-stripped',
              ssh_identity_file: '/path/to/key',
              token: 'bearer-xyz',
              password: 'admin123',
              OS_HTTP_SECRET: 'os-secret',
              GITHUB_TOKEN: 'ghp_123',
            });
          }

          if (buffer.includes('event: worker:status')) {
            // Verify secrets are stripped
            expect(buffer).not.toContain('should-be-stripped');
            expect(buffer).not.toContain('/path/to/key');
            expect(buffer).not.toContain('bearer-xyz');
            expect(buffer).not.toContain('admin123');
            expect(buffer).not.toContain('os-secret');
            expect(buffer).not.toContain('ghp_123');

            // Verify safe fields are present
            expect(buffer).toContain('worker-test');
            expect(buffer).toContain('"status":"online"');

            res.destroy();
            resolve();
          }
        });

        setTimeout(() => {
          res.destroy();
          reject(new Error('Timeout waiting for SSE event'));
        }, 5000);
      });
      req.on('error', () => { /* expected on destroy */ });
      req.end();
    });
  });

  it('worker list endpoint does not leak secrets', async () => {
    const { body } = await get('/ops/workers', AUTH);
    const raw = JSON.stringify(body);

    // Verify no secrets in response
    expect(raw).not.toContain('super-secret-hmac-key');
    expect(raw).not.toContain('nanoclaw_worker');
    expect(raw).not.toContain('OS_HTTP_SECRET');
    expect(raw).not.toContain(SECRET);
  });

  it('worker detail endpoint does not leak secrets', async () => {
    const { body } = await get('/ops/workers/worker-1', AUTH);
    const raw = JSON.stringify(body);

    expect(raw).not.toContain('super-secret-hmac-key');
    expect(raw).not.toContain('nanoclaw_worker');
  });
});

// --- Connection Limits ---

describe('SSE connection limits', () => {
  it('allows up to 3 connections from same source', () => {
    return new Promise<void>((resolve) => {
      const connections: http.ClientRequest[] = [];
      let connected = 0;

      for (let i = 0; i < 3; i++) {
        const url = new URL('/ops/events', baseUrl);
        const req = http.request(url, { method: 'GET', headers: AUTH }, (res) => {
          if (res.statusCode === 200) {
            connected++;
            if (connected === 3) {
              // All 3 connected — try a 4th
              const url4 = new URL('/ops/events', baseUrl);
              const req4 = http.request(url4, { method: 'GET', headers: AUTH }, (res4) => {
                expect(res4.statusCode).toBe(429);
                connections.forEach((c) => c.destroy());
                res4.resume();
                resolve();
              });
              req4.on('error', () => { /* ignore */ });
              req4.end();
              connections.push(req4);
            }
          }
          res.on('error', () => { /* ignore on destroy */ });
        });
        req.on('error', () => { /* ignore on destroy */ });
        req.end();
        connections.push(req);
      }
    });
  });
});
