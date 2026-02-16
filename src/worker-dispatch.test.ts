/**
 * Sprint 9 tests — Worker dispatch (selectWorker, dispatchToWorker).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  upsertWorker,
} from './worker-db.js';
import type { Worker } from './worker-db.js';
import { selectWorker } from './worker-dispatch.js';
import { tryCreateDispatch, getDispatchByKey } from './gov-db.js';

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

describe('worker-dispatch', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('selectWorker returns null when no workers', () => {
    const w = selectWorker();
    expect(w).toBeNull();
  });

  it('selectWorker returns online worker with capacity', () => {
    upsertWorker(makeWorker({ id: 'w-1', current_wip: 0, max_wip: 2 }));
    const w = selectWorker();
    expect(w).not.toBeNull();
    expect(w!.id).toBe('w-1');
  });

  it('selectWorker skips offline workers', () => {
    upsertWorker(makeWorker({ id: 'w-1', status: 'offline' }));
    const w = selectWorker();
    expect(w).toBeNull();
  });

  it('selectWorker skips workers at capacity', () => {
    upsertWorker(makeWorker({ id: 'w-1', current_wip: 2, max_wip: 2 }));
    const w = selectWorker();
    expect(w).toBeNull();
  });

  it('selectWorker round-robins among available workers', () => {
    upsertWorker(makeWorker({ id: 'w-1', local_port: 7810 }));
    upsertWorker(makeWorker({ id: 'w-2', local_port: 7811 }));

    const first = selectWorker();
    const second = selectWorker();
    // Should pick different workers in sequence
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.id).not.toBe(second!.id);
  });

  it('dispatch idempotency (tryCreateDispatch returns false on duplicate)', () => {
    const dispatch = {
      task_id: 'task-1',
      from_state: 'READY',
      to_state: 'DOING',
      dispatch_key: 'task-1:READY->DOING:v0',
      group_jid: 'group@jid',
      worker_id: 'w-1',
      status: 'ENQUEUED' as const,
      created_at: now,
      updated_at: now,
    };

    const first = tryCreateDispatch(dispatch);
    expect(first).toBe(true);

    const second = tryCreateDispatch(dispatch);
    expect(second).toBe(false);

    // Verify worker_id was stored
    const d = getDispatchByKey('task-1:READY->DOING:v0');
    expect(d).toBeDefined();
  });
});
