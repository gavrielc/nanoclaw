/**
 * Sprint 9 tests — Worker HMAC+TTL+Replay auth.
 */
import { describe, it, expect } from 'vitest';
import {
  signWorkerRequest,
  makeWorkerHeaders,
  verifyWorkerRequest,
} from './worker-auth.js';

const SECRET = 'test-worker-secret-42';

describe('worker-auth', () => {
  const nonces = new Set<string>();
  const checkNonce = (id: string) => nonces.has(id);
  const saveNonce = (id: string) => { nonces.add(id); };

  it('sign + verify round-trip succeeds', () => {
    nonces.clear();
    const body = '{"hello":"world"}';
    const sig = signWorkerRequest(body, SECRET);

    const result = verifyWorkerRequest(
      {
        'x-worker-hmac': sig.hmac,
        'x-worker-timestamp': sig.timestamp,
        'x-worker-requestid': sig.requestId,
      },
      body,
      SECRET,
      checkNonce,
      saveNonce,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects missing headers', () => {
    const result = verifyWorkerRequest(
      {},
      '{}',
      SECRET,
      checkNonce,
      saveNonce,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('MISSING_HEADERS');
  });

  it('rejects expired timestamp (TTL)', () => {
    nonces.clear();
    const body = '{"test":"ttl"}';
    const sig = signWorkerRequest(body, SECRET);

    // Override timestamp to 120 seconds ago (beyond default 60s TTL)
    const oldTimestamp = new Date(Date.now() - 120_000).toISOString();
    const result = verifyWorkerRequest(
      {
        'x-worker-hmac': sig.hmac,
        'x-worker-timestamp': oldTimestamp,
        'x-worker-requestid': sig.requestId,
      },
      body,
      SECRET,
      checkNonce,
      saveNonce,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('TTL_EXPIRED');
  });

  it('rejects future timestamp (clock skew >60s)', () => {
    nonces.clear();
    const body = '{"test":"future"}';
    const sig = signWorkerRequest(body, SECRET);

    const futureTimestamp = new Date(Date.now() + 120_000).toISOString();
    const result = verifyWorkerRequest(
      {
        'x-worker-hmac': sig.hmac,
        'x-worker-timestamp': futureTimestamp,
        'x-worker-requestid': sig.requestId,
      },
      body,
      SECRET,
      checkNonce,
      saveNonce,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('TTL_EXPIRED');
  });

  it('rejects replayed request_id', () => {
    nonces.clear();
    const body = '{"test":"replay"}';
    const sig = signWorkerRequest(body, SECRET);

    const headers = {
      'x-worker-hmac': sig.hmac,
      'x-worker-timestamp': sig.timestamp,
      'x-worker-requestid': sig.requestId,
    };

    // First request succeeds
    const result1 = verifyWorkerRequest(headers, body, SECRET, checkNonce, saveNonce);
    expect(result1.ok).toBe(true);

    // Replay fails
    const result2 = verifyWorkerRequest(headers, body, SECRET, checkNonce, saveNonce);
    expect(result2.ok).toBe(false);
    expect(result2.error).toBe('REPLAY_DETECTED');
  });

  it('rejects wrong HMAC secret', () => {
    nonces.clear();
    const body = '{"test":"wrong-secret"}';
    const sig = signWorkerRequest(body, SECRET);

    const result = verifyWorkerRequest(
      {
        'x-worker-hmac': sig.hmac,
        'x-worker-timestamp': sig.timestamp,
        'x-worker-requestid': sig.requestId,
      },
      body,
      'wrong-secret',
      checkNonce,
      saveNonce,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('HMAC_INVALID');
  });

  it('rejects tampered body', () => {
    nonces.clear();
    const body = '{"test":"original"}';
    const sig = signWorkerRequest(body, SECRET);

    const result = verifyWorkerRequest(
      {
        'x-worker-hmac': sig.hmac,
        'x-worker-timestamp': sig.timestamp,
        'x-worker-requestid': sig.requestId,
      },
      '{"test":"tampered"}',
      SECRET,
      checkNonce,
      saveNonce,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('HMAC_INVALID');
  });

  it('makeWorkerHeaders produces correct header set', () => {
    const body = '{"test":"headers"}';
    const headers = makeWorkerHeaders(body, SECRET, 'worker-1');

    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Worker-HMAC']).toBeDefined();
    expect(headers['X-Worker-Timestamp']).toBeDefined();
    expect(headers['X-Worker-RequestId']).toBeDefined();
    expect(headers['X-Worker-Id']).toBe('worker-1');
  });
});
