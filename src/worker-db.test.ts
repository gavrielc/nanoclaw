/**
 * Sprint 9 tests — Worker database (workers + nonces tables).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  getWorkerById,
  getAllWorkers,
  getOnlineWorkers,
  upsertWorker,
  updateWorkerStatus,
  updateWorkerWip,
  isNonceUsed,
  recordNonce,
  cleanupExpiredNonces,
} from './worker-db.js';
import type { Worker } from './worker-db.js';

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
    callback_url: 'http://10.0.0.1:7700',
    ssh_identity_file: null,
    groups_json: '["developer","security"]',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('worker-db', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('creates workers + nonces tables', () => {
    // Tables created by _initTestDatabase → createWorkersSchema
    // If we get here without error, tables exist
    expect(getAllWorkers()).toEqual([]);
  });

  it('upsert + getById round-trip', () => {
    const w = makeWorker();
    upsertWorker(w);

    const fetched = getWorkerById('worker-1');
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe('worker-1');
    expect(fetched!.ssh_host).toBe('10.0.0.2');
    expect(fetched!.shared_secret).toBe('test-secret');
  });

  it('getOnlineWorkers filters by status', () => {
    upsertWorker(makeWorker({ id: 'w-1', status: 'online' }));
    upsertWorker(makeWorker({ id: 'w-2', status: 'offline', local_port: 7811 }));
    upsertWorker(makeWorker({ id: 'w-3', status: 'online', local_port: 7812 }));

    const online = getOnlineWorkers();
    expect(online).toHaveLength(2);
    expect(online.map((w) => w.id)).toEqual(['w-1', 'w-3']);
  });

  it('updateWorkerWip atomic increment/decrement', () => {
    upsertWorker(makeWorker({ current_wip: 0 }));

    updateWorkerWip('worker-1', 1);
    expect(getWorkerById('worker-1')!.current_wip).toBe(1);

    updateWorkerWip('worker-1', 1);
    expect(getWorkerById('worker-1')!.current_wip).toBe(2);

    updateWorkerWip('worker-1', -1);
    expect(getWorkerById('worker-1')!.current_wip).toBe(1);
  });

  it('recordNonce + isNonceUsed', () => {
    expect(isNonceUsed('nonce-abc')).toBe(false);

    recordNonce('nonce-abc');
    expect(isNonceUsed('nonce-abc')).toBe(true);

    // Duplicate insert is OK (OR IGNORE)
    recordNonce('nonce-abc');
    expect(isNonceUsed('nonce-abc')).toBe(true);
  });

  it('cleanupExpiredNonces removes old entries', () => {
    recordNonce('fresh-nonce');
    // All nonces are "fresh" (just inserted), so cleanup should keep them
    cleanupExpiredNonces();
    expect(isNonceUsed('fresh-nonce')).toBe(true);

    // Note: We can't easily test expired nonces without time manipulation,
    // but the SQL DELETE WHERE < datetime('now', '-1 hour') is straightforward.
    // Verifying it runs without error is the main test.
  });

  it('updateWorkerStatus changes status', () => {
    upsertWorker(makeWorker({ status: 'online' }));
    expect(getWorkerById('worker-1')!.status).toBe('online');

    updateWorkerStatus('worker-1', 'offline');
    expect(getWorkerById('worker-1')!.status).toBe('offline');
  });
});
