import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import { createGovTask, createProduct, logGovActivity } from './gov-db.js';
import { storeMemory } from './memory-db.js';
import { startOpsHttp } from './ops-http.js';

let server: http.Server;
let baseUrl: string;

// Helper: make HTTP GET request
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

const SECRET = 'test-ops-secret-42';
const AUTH = { 'X-OS-SECRET': SECRET };

const now = new Date().toISOString();

function seedData(): void {
  createProduct({
    id: 'prod-1',
    name: 'Alpha',
    status: 'active',
    risk_level: 'normal',
    created_at: now,
    updated_at: now,
  });

  createGovTask({
    id: 'task-1',
    title: 'Fix login bug',
    description: 'Users cannot login',
    task_type: 'BUG',
    state: 'DOING',
    priority: 'P1',
    product: 'Alpha',
    product_id: 'prod-1',
    scope: 'PRODUCT',
    assigned_group: 'developer',
    executor: null,
    created_by: 'main',
    gate: 'None',
    dod_required: 0,
    metadata: null,
    created_at: now,
    updated_at: now,
  });

  createGovTask({
    id: 'task-2',
    title: 'Add dark mode',
    description: 'Feature request',
    task_type: 'FEATURE',
    state: 'INBOX',
    priority: 'P2',
    product: 'Alpha',
    product_id: 'prod-1',
    scope: 'PRODUCT',
    assigned_group: null,
    executor: null,
    created_by: 'main',
    gate: 'None',
    dod_required: 0,
    metadata: null,
    created_at: now,
    updated_at: now,
  });

  logGovActivity({
    task_id: 'task-1',
    action: 'transition',
    from_state: 'READY',
    to_state: 'DOING',
    actor: 'system',
    reason: 'Auto-dispatch',
    created_at: now,
  });

  storeMemory({
    id: 'mem-1',
    content: 'Login endpoint uses JWT tokens',
    content_hash: 'hash1',
    level: 'L1',
    scope: 'COMPANY',
    product_id: null,
    group_folder: 'developer',
    tags: JSON.stringify(['auth', 'jwt']),
    pii_detected: 0,
    pii_types: null,
    source_type: 'agent',
    source_ref: null,
    policy_version: '1.1.0',
    embedding: null,
    embedding_model: null,
    embedding_at: null,
    created_at: now,
    updated_at: now,
  });
}

beforeAll(() => {
  // Set secret via env before importing module (already read at import time,
  // so we pass it to config directly — but ops-http reads from config.ts which
  // reads process.env at import time). We set env before starting server.
  process.env.OS_HTTP_SECRET = SECRET;

  _initTestDatabase();
  seedData();

  return new Promise<void>((resolve) => {
    server = startOpsHttp(0); // port 0 = random
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

describe('ops-http auth', () => {
  it('rejects request without X-OS-SECRET', async () => {
    const { status, body } = await get('/ops/health');
    expect(status).toBe(401);
    expect((body as Record<string, string>).error).toBe('Unauthorized');
  });

  it('rejects request with wrong secret', async () => {
    const { status } = await get('/ops/health', { 'X-OS-SECRET': 'wrong' });
    expect(status).toBe(401);
  });

  it('includes CORS headers on responses', async () => {
    return new Promise<void>((resolve, reject) => {
      const url = new URL('/ops/health', baseUrl);
      const req = http.request(url, { method: 'GET', headers: AUTH }, (res) => {
        expect(res.headers['access-control-allow-origin']).toBe('*');
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });
  });
});

describe('ops-http endpoints', () => {
  it('GET /ops/health returns status and version', async () => {
    const { status, body } = await get('/ops/health', AUTH);
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.status).toBe('ok');
    expect(data.version).toBe('1.1.0');
    expect(typeof data.uptime_seconds).toBe('number');
  });

  it('GET /ops/stats returns aggregated metrics', async () => {
    const { status, body } = await get('/ops/stats', AUTH);
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data).toHaveProperty('tasks');
    expect(data).toHaveProperty('ext_calls');
    expect(data).toHaveProperty('wip_load');
    expect(data).toHaveProperty('failed_dispatches');
  });

  it('GET /ops/tasks returns all tasks', async () => {
    const { status, body } = await get('/ops/tasks', AUTH);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(2);
  });

  it('GET /ops/tasks?state=DOING filters by state', async () => {
    const { status, body } = await get('/ops/tasks?state=DOING', AUTH);
    expect(status).toBe(200);
    const tasks = body as Array<{ state: string }>;
    expect(tasks.length).toBe(1);
    expect(tasks[0].state).toBe('DOING');
  });

  it('GET /ops/tasks?type=BUG filters by type', async () => {
    const { status, body } = await get('/ops/tasks?type=BUG', AUTH);
    expect(status).toBe(200);
    const tasks = body as Array<{ task_type: string }>;
    expect(tasks.length).toBe(1);
    expect(tasks[0].task_type).toBe('BUG');
  });

  it('GET /ops/tasks?product_id=prod-1 filters by product', async () => {
    const { status, body } = await get('/ops/tasks?product_id=prod-1', AUTH);
    expect(status).toBe(200);
    expect((body as unknown[]).length).toBe(2);
  });

  it('GET /ops/tasks/:id returns single task', async () => {
    const { status, body } = await get('/ops/tasks/task-1', AUTH);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).id).toBe('task-1');
    expect((body as Record<string, unknown>).title).toBe('Fix login bug');
  });

  it('GET /ops/tasks/:id returns 404 for missing task', async () => {
    const { status } = await get('/ops/tasks/nonexistent', AUTH);
    expect(status).toBe(404);
  });

  it('GET /ops/tasks/:id/activities returns activities', async () => {
    const { status, body } = await get('/ops/tasks/task-1/activities', AUTH);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('GET /ops/tasks/:id/activities returns 404 for missing task', async () => {
    const { status } = await get('/ops/tasks/nonexistent/activities', AUTH);
    expect(status).toBe(404);
  });

  it('GET /ops/products returns all products', async () => {
    const { status, body } = await get('/ops/products', AUTH);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(1);
  });

  it('GET /ops/products/:id returns single product', async () => {
    const { status, body } = await get('/ops/products/prod-1', AUTH);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).name).toBe('Alpha');
  });

  it('GET /ops/products/:id returns 404 for missing product', async () => {
    const { status } = await get('/ops/products/nonexistent', AUTH);
    expect(status).toBe(404);
  });

  it('GET /ops/memories?q=JWT returns matching memories', async () => {
    const { status, body } = await get('/ops/memories?q=JWT', AUTH);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('GET /ops/memories without q returns 400', async () => {
    const { status } = await get('/ops/memories', AUTH);
    expect(status).toBe(400);
  });

  it('returns 404 for unknown routes', async () => {
    const { status } = await get('/ops/unknown', AUTH);
    expect(status).toBe(404);
  });

  it('POST requests require dual-secret auth (returns 401 without write secret)', async () => {
    return new Promise<void>((resolve, reject) => {
      const url = new URL('/ops/health', baseUrl);
      const req = http.request(
        url,
        { method: 'POST', headers: AUTH },
        (res) => {
          expect(res.statusCode).toBe(401);
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', reject);
      req.end();
    });
  });
});
