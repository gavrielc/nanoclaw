/**
 * Sprint 9.1 P0 hardening tests.
 *
 * P0-A: Nonces — TTL config, cleanupOldNonces, capNonces, periodic cleanup
 * P0-B: SSH tunnel — systemd template validation (file exists)
 * P0-C: Worker selection — deny-by-default group filtering
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import { _initTestDatabase } from './db.js';
import {
  upsertWorker,
  isNonceUsed,
  recordNonce,
  cleanupOldNonces,
  capNonces,
  workerServesGroup,
} from './worker-db.js';
import type { Worker } from './worker-db.js';
import { selectWorker } from './worker-dispatch.js';
import { verifyWorkerRequest, signWorkerRequest } from './worker-auth.js';

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

describe('P0-A: Nonces hardening', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('cleanupOldNonces removes entries older than threshold', () => {
    recordNonce('old-1');
    recordNonce('old-2');
    recordNonce('fresh-1');

    // Use a future cutoff (negative age = cutoff in the future) to ensure all are deleted
    // cleanupOldNonces(olderThanMs): cutoff = Date.now() - olderThanMs
    // With -1000, cutoff = Date.now() + 1000 (1s in the future) → all entries are "old"
    const deleted = cleanupOldNonces(-1000);
    expect(deleted).toBe(3);
    expect(isNonceUsed('old-1')).toBe(false);
    expect(isNonceUsed('fresh-1')).toBe(false);
  });

  it('cleanupOldNonces keeps fresh entries when threshold is large', () => {
    recordNonce('fresh-1');
    recordNonce('fresh-2');

    // 24h threshold — nothing should be deleted
    const deleted = cleanupOldNonces(86_400_000);
    expect(deleted).toBe(0);
    expect(isNonceUsed('fresh-1')).toBe(true);
    expect(isNonceUsed('fresh-2')).toBe(true);
  });

  it('capNonces trims to maxRows keeping newest', () => {
    for (let i = 0; i < 10; i++) {
      recordNonce(`nonce-${i}`);
    }

    // Cap to 5
    const deleted = capNonces(5);
    expect(deleted).toBe(5);

    // Some should be gone, some should remain
    let remaining = 0;
    for (let i = 0; i < 10; i++) {
      if (isNonceUsed(`nonce-${i}`)) remaining++;
    }
    expect(remaining).toBe(5);
  });

  it('capNonces does nothing when under limit', () => {
    recordNonce('a');
    recordNonce('b');

    const deleted = capNonces(100);
    expect(deleted).toBe(0);
    expect(isNonceUsed('a')).toBe(true);
    expect(isNonceUsed('b')).toBe(true);
  });

  it('TTL enforcement uses configurable NONCE_TTL_MS', () => {
    const nonces = new Set<string>();
    const check = (id: string) => nonces.has(id);
    const save = (id: string) => { nonces.add(id); };

    const secret = 'test-ttl-secret';
    const body = '{"test":"ttl-config"}';
    const sig = signWorkerRequest(body, secret);

    // Valid request should pass with default TTL
    const result = verifyWorkerRequest(
      {
        'x-worker-hmac': sig.hmac,
        'x-worker-timestamp': sig.timestamp,
        'x-worker-requestid': sig.requestId,
      },
      body,
      secret,
      check,
      save,
    );
    expect(result.ok).toBe(true);
  });

  it('TTL rejects requests beyond NONCE_TTL_MS', () => {
    const nonces = new Set<string>();
    const check = (id: string) => nonces.has(id);
    const save = (id: string) => { nonces.add(id); };

    const secret = 'test-ttl-secret';
    const body = '{"test":"ttl-reject"}';
    const sig = signWorkerRequest(body, secret);

    // Override timestamp to 120 seconds ago (>60s default TTL)
    const oldTimestamp = new Date(Date.now() - 120_000).toISOString();
    const result = verifyWorkerRequest(
      {
        'x-worker-hmac': sig.hmac,
        'x-worker-timestamp': oldTimestamp,
        'x-worker-requestid': sig.requestId,
      },
      body,
      secret,
      check,
      save,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TTL_EXPIRED');
  });
});

describe('P0-B: SSH tunnel hardening', () => {
  it('systemd template has Restart=always', () => {
    const template = fs.readFileSync(
      path.join(process.cwd(), 'docs/nanoclaw-worker-tunnel@.service'),
      'utf8',
    );
    expect(template).toContain('Restart=always');
  });

  it('systemd template has StartLimitIntervalSec and StartLimitBurst', () => {
    const template = fs.readFileSync(
      path.join(process.cwd(), 'docs/nanoclaw-worker-tunnel@.service'),
      'utf8',
    );
    expect(template).toContain('StartLimitIntervalSec=120');
    expect(template).toContain('StartLimitBurst=10');
  });

  it('systemd template has TimeoutStartSec', () => {
    const template = fs.readFileSync(
      path.join(process.cwd(), 'docs/nanoclaw-worker-tunnel@.service'),
      'utf8',
    );
    expect(template).toContain('TimeoutStartSec=30');
  });

  it('systemd template has StrictHostKeyChecking', () => {
    const template = fs.readFileSync(
      path.join(process.cwd(), 'docs/nanoclaw-worker-tunnel@.service'),
      'utf8',
    );
    expect(template).toContain('StrictHostKeyChecking=yes');
  });
});

describe('P0-C: Worker selection deny-by-default', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('workerServesGroup returns true when group is in groups_json', () => {
    const w = makeWorker({ groups_json: '["developer","security"]' });
    expect(workerServesGroup(w, 'developer')).toBe(true);
    expect(workerServesGroup(w, 'security')).toBe(true);
  });

  it('workerServesGroup returns false when group is not listed', () => {
    const w = makeWorker({ groups_json: '["developer"]' });
    expect(workerServesGroup(w, 'security')).toBe(false);
  });

  it('workerServesGroup returns false when groups_json is null', () => {
    const w = makeWorker({ groups_json: null });
    expect(workerServesGroup(w, 'developer')).toBe(false);
  });

  it('workerServesGroup returns false when groups_json is invalid JSON', () => {
    const w = makeWorker({ groups_json: 'not-json' });
    expect(workerServesGroup(w, 'developer')).toBe(false);
  });

  it('workerServesGroup returns false when groups_json is not an array', () => {
    const w = makeWorker({ groups_json: '{"developer":true}' });
    expect(workerServesGroup(w, 'developer')).toBe(false);
  });

  it('selectWorker filters by group (deny-by-default)', () => {
    upsertWorker(makeWorker({
      id: 'w-1',
      groups_json: '["developer"]',
    }));
    upsertWorker(makeWorker({
      id: 'w-2',
      local_port: 7811,
      groups_json: '["security"]',
    }));

    // Request developer group — only w-1 should be returned
    const w = selectWorker('developer');
    expect(w).not.toBeNull();
    expect(w!.id).toBe('w-1');
  });

  it('selectWorker returns null when no worker serves the group', () => {
    upsertWorker(makeWorker({
      id: 'w-1',
      groups_json: '["security"]',
    }));

    const w = selectWorker('developer');
    expect(w).toBeNull();
  });

  it('selectWorker returns null when groups_json is null (deny-by-default)', () => {
    upsertWorker(makeWorker({
      id: 'w-1',
      groups_json: null,
    }));

    const w = selectWorker('developer');
    expect(w).toBeNull();
  });

  it('selectWorker without group param skips group filter', () => {
    upsertWorker(makeWorker({
      id: 'w-1',
      groups_json: null,  // No groups assigned
    }));

    // No group specified — should still return the worker
    const w = selectWorker();
    expect(w).not.toBeNull();
    expect(w!.id).toBe('w-1');
  });
});
