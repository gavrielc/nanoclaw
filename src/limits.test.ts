/**
 * Sprint 6 — Rate limits, quotas, circuit breakers test suite.
 * Covers: limits-db CRUD, breaker state machine, config defaults, enforce functions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  countDenials24h,
  getAllBreakers,
  getAllQuotasToday,
  getBreaker,
  getDenialsByCode24h,
  incrementQuota,
  incrementRateLimit,
  logLimitDenial,
  purgeOldRateLimits,
  upsertBreaker,
} from './limits-db.js';
import { checkBreaker, recordFailure, recordSuccess } from './limits/breaker.js';
import {
  buildScopeKey,
  ErrorCodes,
  getBreakerConfig,
  getQuotaLimits,
  getRateLimit,
  limitsEnabled,
} from './limits/config.js';
import {
  enforceEmbedLimits,
  enforceExtCallLimits,
  enforceGovLimits,
} from './limits/enforce.js';

beforeEach(() => {
  _initTestDatabase();
  // Enable limits for tests
  process.env.LIMITS_ENABLED = '1';
  process.env.EXT_CALLS_ENABLED = '1';
  process.env.EMBEDDINGS_ENABLED = '1';
});

// --- limits-db CRUD ---

describe('limits-db', () => {
  describe('rate_limits', () => {
    it('incrementRateLimit returns 1 on first call', () => {
      const count = incrementRateLimit('ext_call', 'dev:github:L1');
      expect(count).toBe(1);
    });

    it('incrementRateLimit increments on subsequent calls', () => {
      incrementRateLimit('ext_call', 'dev:github:L1');
      incrementRateLimit('ext_call', 'dev:github:L1');
      const count = incrementRateLimit('ext_call', 'dev:github:L1');
      expect(count).toBe(3);
    });

    it('different scope keys are independent', () => {
      incrementRateLimit('ext_call', 'dev:github:L1');
      incrementRateLimit('ext_call', 'dev:github:L1');
      const count = incrementRateLimit('ext_call', 'sec:github:L1');
      expect(count).toBe(1);
    });

    it('purgeOldRateLimits removes stale entries', () => {
      incrementRateLimit('ext_call', 'dev:github:L1');
      // purge won't remove current-minute entries
      purgeOldRateLimits();
      const count = incrementRateLimit('ext_call', 'dev:github:L1');
      expect(count).toBe(2);
    });
  });

  describe('quotas_daily', () => {
    it('incrementQuota returns used=1 on first call', () => {
      const q = incrementQuota('ext_call', 'dev:github:L1', 80, 100);
      expect(q.used).toBe(1);
      expect(q.soft_limit).toBe(80);
      expect(q.hard_limit).toBe(100);
    });

    it('incrementQuota accumulates', () => {
      incrementQuota('ext_call', 'dev:github:L1', 80, 100);
      incrementQuota('ext_call', 'dev:github:L1', 80, 100);
      const q = incrementQuota('ext_call', 'dev:github:L1', 80, 100);
      expect(q.used).toBe(3);
    });

    it('getAllQuotasToday returns current day entries', () => {
      incrementQuota('ext_call', 'dev:github:L1', 80, 100);
      incrementQuota('embed', 'dev:openai', 800, 1000);
      const all = getAllQuotasToday();
      expect(all.length).toBe(2);
    });
  });

  describe('provider_breakers', () => {
    it('getBreaker returns undefined for unknown provider', () => {
      expect(getBreaker('unknown')).toBeUndefined();
    });

    it('upsertBreaker creates new entry', () => {
      upsertBreaker('github', { state: 'CLOSED', fail_count: 0 });
      const b = getBreaker('github');
      expect(b).toBeDefined();
      expect(b!.state).toBe('CLOSED');
      expect(b!.fail_count).toBe(0);
    });

    it('upsertBreaker updates existing entry', () => {
      upsertBreaker('github', { state: 'CLOSED', fail_count: 0 });
      upsertBreaker('github', { state: 'OPEN', fail_count: 5, opened_at: new Date().toISOString() });
      const b = getBreaker('github');
      expect(b!.state).toBe('OPEN');
      expect(b!.fail_count).toBe(5);
    });

    it('getAllBreakers returns all entries', () => {
      upsertBreaker('github', { state: 'CLOSED' });
      upsertBreaker('openai', { state: 'OPEN' });
      const all = getAllBreakers();
      expect(all.length).toBe(2);
    });
  });

  describe('limit_denials', () => {
    it('logLimitDenial + countDenials24h', () => {
      logLimitDenial('ext_call', 'dev:github:L1', ErrorCodes.RATE_LIMIT_EXCEEDED);
      logLimitDenial('ext_call', 'dev:github:L2', ErrorCodes.DAILY_QUOTA_EXCEEDED);
      expect(countDenials24h()).toBe(2);
    });

    it('getDenialsByCode24h groups by code', () => {
      logLimitDenial('ext_call', 'a', ErrorCodes.RATE_LIMIT_EXCEEDED);
      logLimitDenial('ext_call', 'b', ErrorCodes.RATE_LIMIT_EXCEEDED);
      logLimitDenial('ext_call', 'c', ErrorCodes.DAILY_QUOTA_EXCEEDED);
      const codes = getDenialsByCode24h();
      expect(codes.find((c) => c.code === ErrorCodes.RATE_LIMIT_EXCEEDED)?.count).toBe(2);
      expect(codes.find((c) => c.code === ErrorCodes.DAILY_QUOTA_EXCEEDED)?.count).toBe(1);
    });
  });
});

// --- Breaker state machine ---

describe('breaker state machine', () => {
  it('checkBreaker allows when no record exists', () => {
    const result = checkBreaker('github');
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('CLOSED');
  });

  it('checkBreaker allows when CLOSED', () => {
    upsertBreaker('github', { state: 'CLOSED', fail_count: 0 });
    const result = checkBreaker('github');
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('CLOSED');
  });

  it('checkBreaker denies when OPEN and cooldown not elapsed', () => {
    upsertBreaker('github', {
      state: 'OPEN',
      fail_count: 5,
      opened_at: new Date().toISOString(),
    });
    const result = checkBreaker('github');
    expect(result.allowed).toBe(false);
    expect(result.state).toBe('OPEN');
  });

  it('checkBreaker transitions OPEN → HALF_OPEN after cooldown', () => {
    const config = getBreakerConfig();
    const pastCooldown = new Date(Date.now() - (config.cooldownSec + 1) * 1000).toISOString();
    upsertBreaker('github', {
      state: 'OPEN',
      fail_count: 5,
      opened_at: pastCooldown,
    });
    const result = checkBreaker('github');
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('HALF_OPEN');
    expect(result.isProbe).toBe(true);
  });

  it('recordSuccess closes breaker from HALF_OPEN', () => {
    upsertBreaker('github', { state: 'HALF_OPEN', fail_count: 5 });
    recordSuccess('github');
    const b = getBreaker('github');
    expect(b!.state).toBe('CLOSED');
    expect(b!.fail_count).toBe(0);
  });

  it('recordFailure reopens breaker from HALF_OPEN', () => {
    upsertBreaker('github', { state: 'HALF_OPEN', fail_count: 5 });
    recordFailure('github');
    const b = getBreaker('github');
    expect(b!.state).toBe('OPEN');
  });

  it('recordFailure trips breaker after threshold failures', () => {
    const config = getBreakerConfig();
    for (let i = 0; i < config.openAfterFails; i++) {
      recordFailure('github');
    }
    const b = getBreaker('github');
    expect(b!.state).toBe('OPEN');
    expect(b!.fail_count).toBe(config.openAfterFails);
  });

  it('recordFailure does not trip before threshold', () => {
    const config = getBreakerConfig();
    for (let i = 0; i < config.openAfterFails - 1; i++) {
      recordFailure('github');
    }
    const b = getBreaker('github');
    expect(b!.state).toBe('CLOSED');
  });
});

// --- Config ---

describe('config', () => {
  it('limitsEnabled respects env var', () => {
    process.env.LIMITS_ENABLED = '1';
    expect(limitsEnabled()).toBe(true);
    process.env.LIMITS_ENABLED = '0';
    expect(limitsEnabled()).toBe(false);
  });

  it('buildScopeKey joins with colon', () => {
    expect(buildScopeKey('dev')).toBe('dev');
    expect(buildScopeKey('dev', 'github')).toBe('dev:github');
    expect(buildScopeKey('dev', 'github', 'L1')).toBe('dev:github:L1');
  });

  it('getRateLimit returns defaults for known ops', () => {
    const limit = getRateLimit('gov_transition', 'dev');
    expect(limit).toBeGreaterThan(0);
  });

  it('getRateLimit returns env override when set', () => {
    // Env var format: RL_EXT_CALL_{PROVIDER}_{LEVEL}_PER_MIN_{GROUP}
    process.env.RL_EXT_CALL_GITHUB_L1_PER_MIN_DEV = '99';
    const limit = getRateLimit('ext_call', 'dev', 'github', 'L1');
    expect(limit).toBe(99);
    delete process.env.RL_EXT_CALL_GITHUB_L1_PER_MIN_DEV;
  });

  it('getQuotaLimits returns soft and hard', () => {
    const q = getQuotaLimits('ext_call', 'dev', 'github', 'L1');
    expect(q.soft).toBeGreaterThan(0);
    expect(q.hard).toBeGreaterThanOrEqual(q.soft);
  });

  it('getBreakerConfig returns valid config', () => {
    const c = getBreakerConfig();
    expect(c.openAfterFails).toBeGreaterThan(0);
    expect(c.cooldownSec).toBeGreaterThan(0);
    expect(c.failWindowSec).toBeGreaterThan(0);
    expect(c.halfOpenProbes).toBeGreaterThan(0);
  });
});

// --- Enforce ---

describe('enforce', () => {
  describe('enforceGovLimits', () => {
    it('allows when limits disabled', () => {
      process.env.LIMITS_ENABLED = '0';
      const r = enforceGovLimits('gov_transition', 'dev');
      expect(r.allowed).toBe(true);
    });

    it('allows within rate limit', () => {
      const r = enforceGovLimits('gov_transition', 'dev');
      expect(r.allowed).toBe(true);
    });

    it('denies when rate limit exceeded', () => {
      const limit = getRateLimit('gov_transition', 'dev');
      for (let i = 0; i < limit; i++) {
        enforceGovLimits('gov_transition', 'dev');
      }
      const r = enforceGovLimits('gov_transition', 'dev');
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(ErrorCodes.RATE_LIMIT_EXCEEDED);
    });
  });

  describe('enforceExtCallLimits', () => {
    it('allows when limits disabled', () => {
      process.env.LIMITS_ENABLED = '0';
      const r = enforceExtCallLimits('dev', 'github', 1);
      expect(r.allowed).toBe(true);
    });

    it('denies when ext_calls kill switch is off', () => {
      process.env.EXT_CALLS_ENABLED = '0';
      const r = enforceExtCallLimits('dev', 'github', 1);
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(ErrorCodes.LIMITS_DISABLED);
    });

    it('denies when provider breaker is OPEN', () => {
      upsertBreaker('github', {
        state: 'OPEN',
        fail_count: 5,
        opened_at: new Date().toISOString(),
      });
      const r = enforceExtCallLimits('dev', 'github', 1);
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(ErrorCodes.PROVIDER_BREAKER_OPEN);
    });

    it('denies when rate limit is 0 (hard deny)', () => {
      // developer:github:L3 defaults to 0 rate limit → NOT_AUTHORIZED
      const r = enforceExtCallLimits('developer', 'github', 3);
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(ErrorCodes.NOT_AUTHORIZED);
    });

    it('allows within rate limit and quota', () => {
      const r = enforceExtCallLimits('dev', 'github', 1);
      expect(r.allowed).toBe(true);
      expect(r.softWarn).toBe(false);
    });

    it('allows with soft warning when quota exceeds soft limit', () => {
      // Use small custom quotas to test without hitting rate limits
      // Set rate limit very high so rate limiter doesn't interfere
      process.env.RL_EXT_CALL_GITHUB_L1_PER_MIN_DEV = '99999';
      process.env.QUOTA_EXT_CALL_GITHUB_L1_DEV_SOFT = '5';
      process.env.QUOTA_EXT_CALL_GITHUB_L1_DEV_HARD = '10';

      // Burn through to soft limit
      for (let i = 0; i < 5; i++) {
        enforceExtCallLimits('dev', 'github', 1);
      }
      const r = enforceExtCallLimits('dev', 'github', 1);
      // Should still be allowed but with soft warning
      expect(r.allowed).toBe(true);
      expect(r.softWarn).toBe(true);
      expect(r.code).toBe(ErrorCodes.DAILY_QUOTA_SOFT_WARN);

      delete process.env.RL_EXT_CALL_GITHUB_L1_PER_MIN_DEV;
      delete process.env.QUOTA_EXT_CALL_GITHUB_L1_DEV_SOFT;
      delete process.env.QUOTA_EXT_CALL_GITHUB_L1_DEV_HARD;
    });

    it('denies when quota exceeds hard limit', () => {
      // Use small custom quotas to test without hitting rate limits
      process.env.RL_EXT_CALL_GITHUB_L1_PER_MIN_DEV = '99999';
      process.env.QUOTA_EXT_CALL_GITHUB_L1_DEV_SOFT = '3';
      process.env.QUOTA_EXT_CALL_GITHUB_L1_DEV_HARD = '5';

      // Burn through to hard limit
      for (let i = 0; i < 5; i++) {
        enforceExtCallLimits('dev', 'github', 1);
      }
      const r = enforceExtCallLimits('dev', 'github', 1);
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(ErrorCodes.DAILY_QUOTA_EXCEEDED);

      delete process.env.RL_EXT_CALL_GITHUB_L1_PER_MIN_DEV;
      delete process.env.QUOTA_EXT_CALL_GITHUB_L1_DEV_SOFT;
      delete process.env.QUOTA_EXT_CALL_GITHUB_L1_DEV_HARD;
    });

    it('logs denial in limit_denials table', () => {
      process.env.EXT_CALLS_ENABLED = '0';
      enforceExtCallLimits('dev', 'github', 1);
      expect(countDenials24h()).toBe(1);
    });
  });

  describe('enforceEmbedLimits', () => {
    it('allows when limits disabled', () => {
      process.env.LIMITS_ENABLED = '0';
      const r = enforceEmbedLimits('dev');
      expect(r.allowed).toBe(true);
    });

    it('denies when embeddings kill switch is off', () => {
      process.env.EMBEDDINGS_ENABLED = '0';
      const r = enforceEmbedLimits('dev');
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(ErrorCodes.LIMITS_DISABLED);
    });

    it('denies when provider breaker is OPEN (fallback to keyword)', () => {
      upsertBreaker('openai', {
        state: 'OPEN',
        fail_count: 5,
        opened_at: new Date().toISOString(),
      });
      const r = enforceEmbedLimits('dev', 'openai');
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(ErrorCodes.PROVIDER_BREAKER_OPEN);
    });

    it('allows within rate limit and quota', () => {
      const r = enforceEmbedLimits('dev', 'openai');
      expect(r.allowed).toBe(true);
    });
  });
});

// --- Integration: denial audit does not log raw params ---

describe('denial audit (no raw params)', () => {
  it('limit_denials table never contains raw params', () => {
    // Trigger multiple denials
    process.env.EXT_CALLS_ENABLED = '0';
    enforceExtCallLimits('dev', 'github', 1);
    enforceExtCallLimits('dev', 'github', 2);

    // Check denials don't have any params columns
    const denials = getDenialsByCode24h();
    for (const d of denials) {
      // Verify shape is { code, count } — no params field
      expect(Object.keys(d)).toEqual(['code', 'count']);
    }
  });
});
