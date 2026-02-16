/**
 * Sprint 9 tests — Worker service HTTP endpoints.
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import { startWorkerService } from './worker-service.js';
import type { DispatchPayload } from './worker-service.js';
import { signWorkerRequest } from './worker-auth.js';

let server: http.Server;
let baseUrl: string;

const SHARED_SECRET = 'test-worker-hmac-secret';

function request(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts: http.RequestOptions = {
      method,
      headers: { ...headers },
    };
    if (body) {
      opts.headers = {
        ...opts.headers,
        'Content-Length': String(Buffer.byteLength(body)),
      };
    }
    const req = http.request(url, opts, (res) => {
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
    if (body) req.write(body);
    req.end();
  });
}

function makeAuthHeaders(body: string): Record<string, string> {
  const sig = signWorkerRequest(body, SHARED_SECRET);
  return {
    'Content-Type': 'application/json',
    'X-Worker-HMAC': sig.hmac,
    'X-Worker-Timestamp': sig.timestamp,
    'X-Worker-RequestId': sig.requestId,
  };
}

describe('worker-service', () => {
  beforeAll(async () => {
    process.env.WORKER_SHARED_SECRET = SHARED_SECRET;
    _initTestDatabase();

    const mockDeps = {
      runTask: async (_payload: DispatchPayload) => {
        // no-op for tests
      },
    };

    server = startWorkerService(mockDeps, 0);
    await new Promise<void>((resolve) => {
      server.once('listening', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
    delete process.env.WORKER_SHARED_SECRET;
  });

  it('binds to 127.0.0.1 only', () => {
    const addr = server.address() as { address: string };
    expect(addr.address).toBe('127.0.0.1');
  });

  it('GET /worker/health returns 200', async () => {
    const res = await request('GET', '/worker/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptime_seconds');
    expect(res.body).toHaveProperty('active_tasks');
  });

  it('POST /worker/dispatch without auth returns 401', async () => {
    const body = JSON.stringify({ taskId: 'test-task' });
    const res = await request('POST', '/worker/dispatch', body, {
      'Content-Type': 'application/json',
    });
    expect(res.status).toBe(401);
  });

  it('POST /worker/dispatch with invalid HMAC returns 401', async () => {
    const body = JSON.stringify({ taskId: 'test-task' });
    const res = await request('POST', '/worker/dispatch', body, {
      'Content-Type': 'application/json',
      'X-Worker-HMAC': 'deadbeef'.repeat(8),
      'X-Worker-Timestamp': new Date().toISOString(),
      'X-Worker-RequestId': 'bad-request-id',
    });
    expect(res.status).toBe(401);
  });

  it('POST /worker/dispatch with valid auth returns 200', async () => {
    const payload: DispatchPayload = {
      taskId: 'task-001',
      groupFolder: 'developer',
      prompt: 'Test prompt',
      isMain: false,
      ipcSecret: 'test-secret',
    };
    const body = JSON.stringify(payload);
    const headers = makeAuthHeaders(body);

    const res = await request('POST', '/worker/dispatch', body, headers);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request('GET', '/unknown');
    expect(res.status).toBe(404);
  });
});
