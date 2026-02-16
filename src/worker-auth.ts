/**
 * Worker Auth — HMAC+TTL+Replay sign/verify for cross-node requests.
 *
 * Both CP→Worker and Worker→CP use the same protocol:
 * - HMAC-SHA256(secret, timestamp + "\n" + requestId + "\n" + body)
 * - TTL: configurable via NONCE_TTL_MS (default 60s)
 * - Replay: nonce table with configurable cleanup
 */
import crypto from 'crypto';

import { NONCE_TTL_MS } from './config.js';

export interface SignResult {
  hmac: string;
  timestamp: string;
  requestId: string;
}

/**
 * Sign a request body with the shared secret.
 */
export function signWorkerRequest(
  body: string,
  secret: string,
): SignResult {
  const timestamp = new Date().toISOString();
  const requestId = crypto.randomUUID();
  const input = `${timestamp}\n${requestId}\n${body}`;
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(input)
    .digest('hex');
  return { hmac, timestamp, requestId };
}

/**
 * Convenience: build headers dict for a request.
 */
export function makeWorkerHeaders(
  body: string,
  secret: string,
  workerId?: string,
): Record<string, string> {
  const sig = signWorkerRequest(body, secret);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Worker-HMAC': sig.hmac,
    'X-Worker-Timestamp': sig.timestamp,
    'X-Worker-RequestId': sig.requestId,
  };
  if (workerId) headers['X-Worker-Id'] = workerId;
  return headers;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify a signed request. Injects isNonceUsed/recordNonce as callbacks
 * so CP and Worker can use their own DB instances.
 */
export function verifyWorkerRequest(
  headers: Record<string, string | undefined>,
  body: string,
  secret: string,
  checkNonce: (requestId: string) => boolean,
  saveNonce: (requestId: string) => void,
): VerifyResult {
  const hmac = headers['x-worker-hmac'];
  const timestamp = headers['x-worker-timestamp'];
  const requestId = headers['x-worker-requestid'];

  // 1. Missing headers
  if (!hmac || !timestamp || !requestId) {
    return { ok: false, error: 'MISSING_HEADERS' };
  }

  // 2. TTL check
  const reqTime = new Date(timestamp).getTime();
  if (isNaN(reqTime)) {
    return { ok: false, error: 'INVALID_TIMESTAMP' };
  }
  const drift = Math.abs(Date.now() - reqTime);
  if (drift > NONCE_TTL_MS) {
    return { ok: false, error: 'TTL_EXPIRED' };
  }

  // 3. Replay check
  if (checkNonce(requestId)) {
    return { ok: false, error: 'REPLAY_DETECTED' };
  }

  // 4. HMAC verification (timing-safe)
  const input = `${timestamp}\n${requestId}\n${body}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(input)
    .digest('hex');

  const hmacBuf = Buffer.from(hmac, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  if (hmacBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(hmacBuf, expectedBuf)) {
    return { ok: false, error: 'HMAC_INVALID' };
  }

  // 5. Record nonce after all checks pass
  saveNonce(requestId);

  return { ok: true };
}
