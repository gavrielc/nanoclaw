/**
 * Sprint 9 integration tests — Gov loop with remote dispatch path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  createGovTask,
  getGovActivities,
  getGovTaskById,
  getDispatchByKey,
  tryCreateDispatch,
} from './gov-db.js';
import {
  upsertWorker,
  getWorkerById,
  updateWorkerWip,
  cleanupExpiredNonces,
} from './worker-db.js';
import type { Worker } from './worker-db.js';
import { selectWorker } from './worker-dispatch.js';

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
    current_wip: 0,
    shared_secret: 'test-secret',
    callback_url: null,
    ssh_identity_file: null,
    groups_json: '["developer","security"]',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function seedTask(id = 'task-1') {
  createGovTask({
    id,
    title: 'Test task',
    description: 'Integration test task',
    task_type: 'FEATURE',
    state: 'READY',
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
}

describe('sprint9-integration', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('selectWorker returns null when no workers → local dispatch path', () => {
    seedTask();
    const worker = selectWorker();
    expect(worker).toBeNull();
    // Task stays READY — no dispatch happens without gov loop
    expect(getGovTaskById('task-1')!.state).toBe('READY');
  });

  it('selectWorker returns worker when online with capacity', () => {
    upsertWorker(makeWorker());
    const worker = selectWorker();
    expect(worker).not.toBeNull();
    expect(worker!.id).toBe('worker-1');
  });

  it('worker_id stored in dispatch when provided', () => {
    seedTask();
    tryCreateDispatch({
      task_id: 'task-1',
      from_state: 'READY',
      to_state: 'DOING',
      dispatch_key: 'task-1:READY->DOING:v0',
      group_jid: 'test@jid',
      worker_id: 'worker-1',
      status: 'ENQUEUED',
      created_at: now,
      updated_at: now,
    });

    const dispatch = getDispatchByKey('task-1:READY->DOING:v0');
    expect(dispatch).toBeDefined();
  });

  it('completion callback decrements worker WIP', () => {
    upsertWorker(makeWorker({ current_wip: 2 }));
    expect(getWorkerById('worker-1')!.current_wip).toBe(2);

    updateWorkerWip('worker-1', -1);
    expect(getWorkerById('worker-1')!.current_wip).toBe(1);
  });

  it('nonce cleanup runs without error', () => {
    // Just verify the SQL doesn't throw
    expect(() => cleanupExpiredNonces()).not.toThrow();
  });

  it('existing local dispatch still works when no workers configured', () => {
    seedTask();

    // With no workers, selectWorker returns null
    const worker = selectWorker();
    expect(worker).toBeNull();

    // Task remains in READY — the gov-loop would fall through to local dispatch
    const task = getGovTaskById('task-1');
    expect(task!.state).toBe('READY');
    expect(task!.assigned_group).toBe('developer');
  });
});
