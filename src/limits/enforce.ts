/**
 * Rate limit + quota + breaker enforcement.
 *
 * Check order: kill switch → breaker → rate limit → quota.
 * Deny-wins: if any check fails, request is denied.
 */

import { incrementQuota, incrementRateLimit, logLimitDenial } from '../limits-db.js';
import { logger } from '../logger.js';
import { emitOpsEvent } from '../ops-events.js';
import { checkBreaker } from './breaker.js';
import {
  buildScopeKey,
  embeddingsEnabled,
  ErrorCodes,
  extCallsEnabled,
  getQuotaLimits,
  getRateLimit,
  limitsEnabled,
  type ErrorCode,
} from './config.js';

export interface EnforceResult {
  allowed: boolean;
  code: ErrorCode | null;
  softWarn: boolean;
  detail?: string;
}

const ALLOW: EnforceResult = { allowed: true, code: null, softWarn: false };

/**
 * Enforce limits for a governance operation (transition or approve).
 */
export function enforceGovLimits(
  op: 'gov_transition' | 'gov_approve',
  group: string,
): EnforceResult {
  if (!limitsEnabled()) return ALLOW;

  const scopeKey = buildScopeKey(group);
  const limit = getRateLimit(op, group);

  // Rate limit
  const count = incrementRateLimit(op, scopeKey);
  if (count > limit) {
    const code = ErrorCodes.RATE_LIMIT_EXCEEDED;
    logLimitDenial(op, scopeKey, code);
    logger.warn({ op, group, count, limit }, 'Rate limit exceeded');
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `${op} rate limit: ${count}/${limit} per minute`,
    };
  }

  // Gov ops don't have daily quotas by default
  return ALLOW;
}

/**
 * Enforce rate limits for cockpit write actions and login attempts.
 */
export function enforceCockpitLimits(
  op: 'cockpit_write' | 'cockpit_login',
  sourceIp: string = 'unknown',
): EnforceResult {
  if (!limitsEnabled()) return ALLOW;

  const scopeKey = buildScopeKey(sourceIp);
  const limit = getRateLimit(op, sourceIp);

  const count = incrementRateLimit(op, scopeKey);
  if (count > limit) {
    const code = ErrorCodes.RATE_LIMIT_EXCEEDED;
    logLimitDenial(op, scopeKey, code);
    logger.warn({ op, sourceIp, count, limit }, 'Cockpit rate limit exceeded');
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `${op} rate limit: ${count}/${limit} per minute`,
    };
  }

  return ALLOW;
}

/**
 * Enforce limits for an external call.
 * Check order: kill switch → breaker → rate limit → quota.
 */
export function enforceExtCallLimits(
  group: string,
  provider: string,
  level: number,
): EnforceResult {
  if (!limitsEnabled()) return ALLOW;

  // Kill switch: ext_calls
  if (!extCallsEnabled()) {
    const code = ErrorCodes.LIMITS_DISABLED;
    logLimitDenial('ext_call', buildScopeKey(group, provider, `L${level}`), code);
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: 'External calls disabled (EXT_CALLS_ENABLED=0)',
    };
  }

  const levelStr = `L${level}`;
  const scopeKey = buildScopeKey(group, provider, levelStr);

  // Breaker check
  const breakerResult = checkBreaker(provider);
  if (!breakerResult.allowed) {
    const code = ErrorCodes.PROVIDER_BREAKER_OPEN;
    logLimitDenial('ext_call', scopeKey, code);
    logger.warn({ provider, state: breakerResult.state }, 'Provider breaker OPEN');
    emitOpsEvent('breaker:state', { provider, state: breakerResult.state, group });
    emitOpsEvent('limits:denial', { op: 'ext_call', scopeKey, code, provider, group });
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `Provider ${provider} circuit breaker is ${breakerResult.state}`,
    };
  }

  // Rate limit (0 = hard deny for this group/provider/level combo)
  const rateLimit = getRateLimit('ext_call', group, provider, levelStr);
  if (rateLimit === 0) {
    const code = ErrorCodes.NOT_AUTHORIZED;
    logLimitDenial('ext_call', scopeKey, code);
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `${group} not authorized for ${provider} ${levelStr}`,
    };
  }

  const count = incrementRateLimit('ext_call', scopeKey);
  if (count > rateLimit) {
    const code = ErrorCodes.RATE_LIMIT_EXCEEDED;
    logLimitDenial('ext_call', scopeKey, code);
    logger.warn({ provider, group, level: levelStr, count, limit: rateLimit }, 'Ext call rate limit exceeded');
    emitOpsEvent('limits:denial', { op: 'ext_call', scopeKey, code, provider, group, level: levelStr });
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `ext_call rate limit: ${count}/${rateLimit} per minute`,
    };
  }

  // Quota check
  const quotaLimits = getQuotaLimits('ext_call', group, provider, levelStr);
  if (quotaLimits.hard === 0) {
    const code = ErrorCodes.NOT_AUTHORIZED;
    logLimitDenial('ext_call', scopeKey, code);
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `${group} has no quota for ${provider} ${levelStr}`,
    };
  }

  const quota = incrementQuota('ext_call', scopeKey, quotaLimits.soft, quotaLimits.hard);

  if (quota.used > quotaLimits.hard) {
    const code = ErrorCodes.DAILY_QUOTA_EXCEEDED;
    logLimitDenial('ext_call', scopeKey, code);
    logger.warn({ provider, group, used: quota.used, hard: quotaLimits.hard }, 'Daily quota exceeded');
    emitOpsEvent('limits:denial', { op: 'ext_call', scopeKey, code, provider, group, used: quota.used, hard: quotaLimits.hard });
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `Daily quota: ${quota.used}/${quotaLimits.hard}`,
    };
  }

  if (quota.used > quotaLimits.soft) {
    logger.info({ provider, group, used: quota.used, soft: quotaLimits.soft }, 'Daily quota soft warning');
    return {
      allowed: true,
      code: ErrorCodes.DAILY_QUOTA_SOFT_WARN,
      softWarn: true,
      detail: `Approaching daily limit: ${quota.used}/${quotaLimits.hard} (soft: ${quotaLimits.soft})`,
    };
  }

  return ALLOW;
}

/**
 * Enforce limits for embedding calls.
 * If breaker OPEN, returns { allowed: false } so caller can fallback to keyword-only.
 */
export function enforceEmbedLimits(
  group: string,
  provider: string = 'openai',
): EnforceResult {
  if (!limitsEnabled()) return ALLOW;

  if (!embeddingsEnabled()) {
    return {
      allowed: false,
      code: ErrorCodes.LIMITS_DISABLED,
      softWarn: false,
      detail: 'Embeddings disabled (EMBEDDINGS_ENABLED=0)',
    };
  }

  const scopeKey = buildScopeKey(group, provider);

  // Breaker check — fallback to keyword-only, not hard fail
  const breakerResult = checkBreaker(provider);
  if (!breakerResult.allowed) {
    return {
      allowed: false,
      code: ErrorCodes.PROVIDER_BREAKER_OPEN,
      softWarn: false,
      detail: `Embedding provider ${provider} breaker ${breakerResult.state} — fallback to keyword`,
    };
  }

  // Rate limit
  const rateLimit = getRateLimit('embed', group, provider);
  const count = incrementRateLimit('embed', scopeKey);
  if (count > rateLimit) {
    const code = ErrorCodes.RATE_LIMIT_EXCEEDED;
    logLimitDenial('embed', scopeKey, code);
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `Embed rate limit: ${count}/${rateLimit} per minute`,
    };
  }

  // Quota
  const quotaLimits = getQuotaLimits('embed', group, provider);
  const quota = incrementQuota('embed', scopeKey, quotaLimits.soft, quotaLimits.hard);

  if (quota.used > quotaLimits.hard) {
    const code = ErrorCodes.DAILY_QUOTA_EXCEEDED;
    logLimitDenial('embed', scopeKey, code);
    return {
      allowed: false,
      code,
      softWarn: false,
      detail: `Embed daily quota: ${quota.used}/${quotaLimits.hard}`,
    };
  }

  if (quota.used > quotaLimits.soft) {
    return {
      allowed: true,
      code: ErrorCodes.DAILY_QUOTA_SOFT_WARN,
      softWarn: true,
      detail: `Embed approaching limit: ${quota.used}/${quotaLimits.hard}`,
    };
  }

  return ALLOW;
}
