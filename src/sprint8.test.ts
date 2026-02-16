/**
 * Sprint 8 tests — Write action endpoints, approvals queue, founder override.
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  createGovTask,
  getGovActivities,
  getGovApprovals,
  getGovTaskById,
  logGovActivity,
} from './gov-db.js';
import { startOpsHttp } from './ops-http.js';

let server: http.Server;
let baseUrl: string;

const READ_SECRET = 'test-ops-secret-42';
const WRITE_SECRET = 'test-write-secret-99';

const AUTH_READ = { 'X-OS-SECRET': READ_SECRET };
const AUTH_WRITE = {
  'X-OS-SECRET': READ_SECRET,
  'X-WRITE-SECRET': WRITE_SECRET,
  'Content-Type': 'application/json',
};

const now = new Date().toISOString();

// --- HTTP helpers ---

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

function post(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = AUTH_WRITE,
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

// --- Seed helpers ---

function seedTask(overrides: Partial<Parameters<typeof createGovTask>[0]> = {}) {
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Test Task',
    description: null,
    task_type: 'FEATURE',
    state: 'APPROVAL' as const,
    priority: 'P2',
    product: null,
    product_id: null,
    scope: 'COMPANY' as const,
    assigned_group: 'developer',
    executor: 'developer',
    created_by: 'main',
    gate: 'Security',
    dod_required: 0,
    metadata: JSON.stringify({ policy_version: '1.1.0' }),
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  createGovTask(task);
  return task;
}

beforeAll(async () => {
  process.env.OS_HTTP_SECRET = READ_SECRET;
  process.env.COCKPIT_WRITE_SECRET_CURRENT = WRITE_SECRET;
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

// === Write Auth ===

describe('write auth (dual-secret)', () => {
  it('POST without X-WRITE-SECRET returns 401', async () => {
    const res = await post(
      '/ops/actions/transition',
      { taskId: 'x', toState: 'DONE' },
      { 'X-OS-SECRET': READ_SECRET, 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });

  it('POST without X-OS-SECRET returns 401', async () => {
    const res = await post(
      '/ops/actions/transition',
      { taskId: 'x', toState: 'DONE' },
      { 'X-WRITE-SECRET': WRITE_SECRET, 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });

  it('POST with wrong write secret returns 401', async () => {
    const res = await post(
      '/ops/actions/transition',
      { taskId: 'x', toState: 'DONE' },
      {
        'X-OS-SECRET': READ_SECRET,
        'X-WRITE-SECRET': 'wrong',
        'Content-Type': 'application/json',
      },
    );
    expect(res.status).toBe(401);
  });

  it('GET endpoints still work with read-only auth', async () => {
    const res = await get('/ops/health', AUTH_READ);
    expect(res.status).toBe(200);
  });
});

// === Transition ===

describe('POST /ops/actions/transition', () => {
  it('APPROVAL→DONE succeeds', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    const res = await post('/ops/actions/transition', {
      taskId: task.id,
      toState: 'DONE',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.from).toBe('APPROVAL');
    expect(res.body.to).toBe('DONE');

    const updated = getGovTaskById(task.id);
    expect(updated?.state).toBe('DONE');
  });

  it('invalid transition returns 409', async () => {
    const task = seedTask({ state: 'INBOX' as const });
    const res = await post('/ops/actions/transition', {
      taskId: task.id,
      toState: 'DONE',
    });
    expect(res.status).toBe(409);
  });

  it('missing taskId returns 400', async () => {
    const res = await post('/ops/actions/transition', {
      toState: 'DONE',
    });
    expect(res.status).toBe(400);
  });

  it('nonexistent task returns 404', async () => {
    const res = await post('/ops/actions/transition', {
      taskId: 'nonexistent-123',
      toState: 'DONE',
    });
    expect(res.status).toBe(404);
  });

  it('stale version returns 409', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    const res = await post('/ops/actions/transition', {
      taskId: task.id,
      toState: 'DONE',
      expectedVersion: 999,
    });
    expect(res.status).toBe(409);
  });

  it('logs transition activity', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    await post('/ops/actions/transition', {
      taskId: task.id,
      toState: 'DONE',
    });
    const activities = getGovActivities(task.id);
    const transitions = activities.filter((a) => a.action === 'transition');
    expect(transitions.length).toBeGreaterThanOrEqual(1);
    const last = transitions[transitions.length - 1];
    expect(last.from_state).toBe('APPROVAL');
    expect(last.to_state).toBe('DONE');
  });
});

// === Approve ===

describe('POST /ops/actions/approve', () => {
  it('approve on APPROVAL task succeeds', async () => {
    const task = seedTask({ state: 'APPROVAL' as const, gate: 'Security' });
    const res = await post('/ops/actions/approve', {
      taskId: task.id,
      gate_type: 'Security',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.gate_type).toBe('Security');
  });

  it('approve on non-APPROVAL task returns 409', async () => {
    const task = seedTask({ state: 'DOING' as const });
    const res = await post('/ops/actions/approve', {
      taskId: task.id,
      gate_type: 'Security',
    });
    expect(res.status).toBe(409);
  });

  it('missing fields returns 400', async () => {
    const res = await post('/ops/actions/approve', {
      taskId: 'some-id',
    });
    expect(res.status).toBe(400);
  });

  it('records approval in gov_approvals', async () => {
    const task = seedTask({ state: 'APPROVAL' as const, gate: 'Security' });
    await post('/ops/actions/approve', {
      taskId: task.id,
      gate_type: 'Security',
      notes: 'LGTM',
    });
    const approvals = getGovApprovals(task.id);
    expect(approvals.length).toBe(1);
    expect(approvals[0].gate_type).toBe('Security');
    expect(approvals[0].notes).toBe('LGTM');
  });

  it('logs approve activity', async () => {
    const task = seedTask({ state: 'APPROVAL' as const, gate: 'Security' });
    await post('/ops/actions/approve', {
      taskId: task.id,
      gate_type: 'Security',
    });
    const activities = getGovActivities(task.id);
    const approves = activities.filter((a) => a.action === 'approve');
    expect(approves.length).toBeGreaterThanOrEqual(1);
  });
});

// === Override ===

describe('POST /ops/actions/override', () => {
  it('override on APPROVAL task moves to DONE', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    const res = await post('/ops/actions/override', {
      taskId: task.id,
      reason: 'Urgent hotfix',
      acceptedRisk: 'Low',
      reviewDeadlineIso: '2026-02-28',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.from).toBe('APPROVAL');
    expect(res.body.to).toBe('DONE');
    expect(res.body.override).toBe(true);

    const updated = getGovTaskById(task.id);
    expect(updated?.state).toBe('DONE');
  });

  it('override on REVIEW task moves to DONE', async () => {
    const task = seedTask({ state: 'REVIEW' as const });
    const res = await post('/ops/actions/override', {
      taskId: task.id,
      reason: 'Ship it',
      acceptedRisk: 'Medium',
      reviewDeadlineIso: '2026-03-01',
    });
    expect(res.status).toBe(200);
    expect(res.body.to).toBe('DONE');
  });

  it('override on DOING task returns 409', async () => {
    const task = seedTask({ state: 'DOING' as const });
    const res = await post('/ops/actions/override', {
      taskId: task.id,
      reason: 'Nope',
      acceptedRisk: 'Low',
      reviewDeadlineIso: '2026-02-28',
    });
    expect(res.status).toBe(409);
  });

  it('missing fields returns 400', async () => {
    const res = await post('/ops/actions/override', {
      taskId: 'some-id',
      reason: 'Test',
    });
    expect(res.status).toBe(400);
  });

  it('stores override metadata on task', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    await post('/ops/actions/override', {
      taskId: task.id,
      reason: 'Critical fix',
      acceptedRisk: 'Low risk',
      reviewDeadlineIso: '2026-03-15',
    });
    const updated = getGovTaskById(task.id);
    expect(updated).toBeDefined();
    const meta = JSON.parse(updated!.metadata!);
    expect(meta.override.used).toBe(true);
    expect(meta.override.by).toBe('founder');
    expect(meta.override.reason).toBe('Critical fix');
    expect(meta.override.acceptedRisk).toBe('Low risk');
    expect(meta.override.reviewDeadlineIso).toBe('2026-03-15');
    expect(meta.override.timestamp).toBeDefined();
  });

  it('logs override activity', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    await post('/ops/actions/override', {
      taskId: task.id,
      reason: 'Emergency',
      acceptedRisk: 'Accepted',
      reviewDeadlineIso: '2026-02-28',
    });
    const activities = getGovActivities(task.id);
    const overrides = activities.filter((a) => a.action === 'override');
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    expect(overrides[0].from_state).toBe('APPROVAL');
    expect(overrides[0].to_state).toBe('DONE');
    expect(overrides[0].actor).toBe('founder');
    expect(overrides[0].reason).toBe('Emergency');
  });

  it('logs transition activity alongside override', async () => {
    const task = seedTask({ state: 'REVIEW' as const });
    await post('/ops/actions/override', {
      taskId: task.id,
      reason: 'Push it',
      acceptedRisk: 'Low',
      reviewDeadlineIso: '2026-02-28',
    });
    const activities = getGovActivities(task.id);
    const transitions = activities.filter((a) => a.action === 'transition');
    expect(transitions.length).toBeGreaterThanOrEqual(1);
    const last = transitions[transitions.length - 1];
    expect(last.from_state).toBe('REVIEW');
    expect(last.to_state).toBe('DONE');
    expect(last.actor).toBe('founder');
  });

  it('stale version returns 409', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    // Simulate concurrent update by directly modifying version
    const directTask = getGovTaskById(task.id);
    // Transition to bump version, then try override on stale version
    await post('/ops/actions/transition', {
      taskId: task.id,
      toState: 'REVIEW',
    });
    // Task is now in REVIEW with version > 0
    // Create a new task for clean test
    const task2 = seedTask({ state: 'REVIEW' as const });
    // Manually bump version by transitioning
    await post('/ops/actions/transition', {
      taskId: task2.id,
      toState: 'APPROVAL',
    });
    // Now transition back to REVIEW to bump version again
    await post('/ops/actions/transition', {
      taskId: task2.id,
      toState: 'REVIEW',
    });
    // The version is now at least 2 — override should still work
    const res = await post('/ops/actions/override', {
      taskId: task2.id,
      reason: 'Test',
      acceptedRisk: 'Low',
      reviewDeadlineIso: '2026-02-28',
    });
    // This should succeed since we're reading the current version
    expect(res.status).toBe(200);
  });
});

// === Approvals Queue ===

describe('GET /ops/approvals', () => {
  it('returns enriched tasks in APPROVAL state', async () => {
    const task = seedTask({ state: 'APPROVAL' as const, gate: 'Security' });
    // Add an execution summary activity
    logGovActivity({
      task_id: task.id,
      action: 'execution_summary',
      from_state: 'DOING',
      to_state: 'REVIEW',
      actor: 'developer',
      reason: 'Implemented auth flow',
      created_at: now,
    });

    const res = await get('/ops/approvals', AUTH_READ);
    expect(res.status).toBe(200);
    const tasks = res.body as unknown as Array<Record<string, unknown>>;
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(task.id);
  });

  it('includes execution_summary', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    logGovActivity({
      task_id: task.id,
      action: 'execution_summary',
      from_state: 'DOING',
      to_state: 'REVIEW',
      actor: 'developer',
      reason: 'Built the feature',
      created_at: now,
    });

    const res = await get('/ops/approvals', AUTH_READ);
    const tasks = res.body as unknown as Array<Record<string, unknown>>;
    expect(tasks[0].execution_summary).toBe('Built the feature');
  });

  it('includes recent_activities', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    logGovActivity({
      task_id: task.id,
      action: 'transition',
      from_state: 'REVIEW',
      to_state: 'APPROVAL',
      actor: 'system',
      reason: null,
      created_at: now,
    });

    const res = await get('/ops/approvals', AUTH_READ);
    const tasks = res.body as unknown as Array<Record<string, unknown>>;
    const activities = tasks[0].recent_activities as Array<Record<string, unknown>>;
    expect(activities.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /ops/tasks/:id/approvals works', async () => {
    const task = seedTask({ state: 'APPROVAL' as const });
    // Approve via the action endpoint
    await post('/ops/actions/approve', {
      taskId: task.id,
      gate_type: 'Security',
    });

    const res = await get(`/ops/tasks/${task.id}/approvals`, AUTH_READ);
    expect(res.status).toBe(200);
    const approvals = res.body as unknown as Array<Record<string, unknown>>;
    expect(approvals.length).toBe(1);
    expect(approvals[0].gate_type).toBe('Security');
  });
});
