/**
 * Circuit breaker state machine for external providers.
 *
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED (on success) or OPEN (on failure)
 *
 * CLOSED: all calls pass through. Track failures within window.
 *   If fail_count >= openAfterFails within failWindowSec → transition to OPEN.
 *
 * OPEN: all calls rejected (PROVIDER_BREAKER_OPEN).
 *   After cooldownSec → transition to HALF_OPEN.
 *
 * HALF_OPEN: allow halfOpenProbes probe(s).
 *   If probe succeeds → CLOSED (reset fail_count).
 *   If probe fails → OPEN (reset cooldown timer).
 */

import {
  getBreaker,
  upsertBreaker,
  type BreakerState,
  type ProviderBreaker,
} from '../limits-db.js';
import { getBreakerConfig } from './config.js';

export interface BreakerCheckResult {
  allowed: boolean;
  state: BreakerState;
  isProbe: boolean;
}

/**
 * Check if a call to this provider should be allowed.
 * Returns { allowed, state, isProbe }.
 */
export function checkBreaker(provider: string): BreakerCheckResult {
  const config = getBreakerConfig();
  const breaker = getBreaker(provider);

  if (!breaker) {
    // No breaker record → CLOSED (first use)
    return { allowed: true, state: 'CLOSED', isProbe: false };
  }

  const now = Date.now();

  switch (breaker.state) {
    case 'CLOSED':
      return { allowed: true, state: 'CLOSED', isProbe: false };

    case 'OPEN': {
      // Check if cooldown has elapsed → transition to HALF_OPEN
      const openedAt = breaker.opened_at
        ? new Date(breaker.opened_at).getTime()
        : 0;
      if (now - openedAt >= config.cooldownSec * 1000) {
        upsertBreaker(provider, {
          state: 'HALF_OPEN',
          last_probe_at: null,
        });
        return { allowed: true, state: 'HALF_OPEN', isProbe: true };
      }
      return { allowed: false, state: 'OPEN', isProbe: false };
    }

    case 'HALF_OPEN': {
      // Allow up to halfOpenProbes probes
      const lastProbe = breaker.last_probe_at
        ? new Date(breaker.last_probe_at).getTime()
        : 0;
      // One probe per cooldown period
      if (now - lastProbe >= config.cooldownSec * 1000) {
        upsertBreaker(provider, {
          last_probe_at: new Date().toISOString(),
        });
        return { allowed: true, state: 'HALF_OPEN', isProbe: true };
      }
      return { allowed: false, state: 'HALF_OPEN', isProbe: false };
    }

    default:
      return { allowed: true, state: 'CLOSED', isProbe: false };
  }
}

/**
 * Record a successful call. If in HALF_OPEN, close the breaker.
 */
export function recordSuccess(provider: string): void {
  const breaker = getBreaker(provider);
  if (!breaker) return;

  if (breaker.state === 'HALF_OPEN') {
    // Probe succeeded → close breaker
    upsertBreaker(provider, {
      state: 'CLOSED',
      fail_count: 0,
      last_fail_at: null,
      opened_at: null,
      last_probe_at: null,
    });
  }
}

/**
 * Record a failed call. If failures exceed threshold within window, open breaker.
 */
export function recordFailure(provider: string): void {
  const config = getBreakerConfig();
  const now = new Date();
  const breaker = getBreaker(provider);

  if (!breaker) {
    // First failure for this provider
    upsertBreaker(provider, {
      state: 'CLOSED',
      fail_count: 1,
      last_fail_at: now.toISOString(),
    });
    return;
  }

  if (breaker.state === 'HALF_OPEN') {
    // Probe failed → reopen
    upsertBreaker(provider, {
      state: 'OPEN',
      fail_count: breaker.fail_count + 1,
      last_fail_at: now.toISOString(),
      opened_at: now.toISOString(),
      last_probe_at: null,
    });
    return;
  }

  // CLOSED state: check if failures within window exceed threshold
  const lastFail = breaker.last_fail_at
    ? new Date(breaker.last_fail_at).getTime()
    : 0;
  const windowMs = config.failWindowSec * 1000;

  // If last failure was outside window, reset count
  let newCount: number;
  if (now.getTime() - lastFail > windowMs) {
    newCount = 1;
  } else {
    newCount = breaker.fail_count + 1;
  }

  if (newCount >= config.openAfterFails) {
    // Trip the breaker
    upsertBreaker(provider, {
      state: 'OPEN',
      fail_count: newCount,
      last_fail_at: now.toISOString(),
      opened_at: now.toISOString(),
    });
  } else {
    upsertBreaker(provider, {
      fail_count: newCount,
      last_fail_at: now.toISOString(),
    });
  }
}
