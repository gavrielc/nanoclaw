/**
 * Limits configuration — env-driven with conservative defaults.
 * All limits are per-minute (rate) or per-day (quota).
 * Naming: RL_{OP}_{PROVIDER}_{LEVEL}_PER_MIN_{GROUP} for rate limits.
 *         QUOTA_{OP}_{PROVIDER}_{LEVEL}_{SOFT|HARD}_{GROUP} for quotas.
 */

// --- Kill switches ---

export function limitsEnabled(): boolean {
  return process.env.LIMITS_ENABLED !== '0';
}

export function extCallsEnabled(): boolean {
  return process.env.EXT_CALLS_ENABLED !== '0';
}

export function embeddingsEnabled(): boolean {
  return process.env.EMBEDDINGS_ENABLED !== '0';
}

// --- Error codes ---

export const ErrorCodes = {
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  DAILY_QUOTA_EXCEEDED: 'DAILY_QUOTA_EXCEEDED',
  DAILY_QUOTA_SOFT_WARN: 'DAILY_QUOTA_SOFT_WARN',
  PROVIDER_BREAKER_OPEN: 'PROVIDER_BREAKER_OPEN',
  LIMITS_DISABLED: 'LIMITS_DISABLED',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// --- Breaker config ---

export function getBreakerConfig() {
  return {
    openAfterFails: intEnv('BREAK_OPEN_AFTER_FAILS', 5),
    failWindowSec: intEnv('BREAK_FAIL_WINDOW_SEC', 120),
    cooldownSec: intEnv('BREAK_COOLDOWN_SEC', 600),
    halfOpenProbes: intEnv('BREAK_HALF_OPEN_PROBES', 1),
  };
}

// --- Rate limit defaults (per minute) ---

const RATE_LIMIT_DEFAULTS: Record<string, number> = {
  // Governance transitions
  'RL_GOV_TRANSITION_PER_MIN_MAIN': 60,
  'RL_GOV_TRANSITION_PER_MIN_DEVELOPER': 30,
  'RL_GOV_TRANSITION_PER_MIN_SECURITY': 30,

  // Governance approvals
  'RL_GOV_APPROVE_PER_MIN_MAIN': 30,
  'RL_GOV_APPROVE_PER_MIN_SECURITY': 20,
  'RL_GOV_APPROVE_PER_MIN_DEVELOPER': 20,

  // Cockpit write actions (via ops-actions.ts)
  'RL_COCKPIT_WRITE_PER_MIN': 20,

  // Cockpit login attempts
  'RL_COCKPIT_LOGIN_PER_MIN': 5,

  // GitHub ext_call
  'RL_EXT_CALL_GITHUB_L1_PER_MIN_MAIN': 30,
  'RL_EXT_CALL_GITHUB_L2_PER_MIN_MAIN': 15,
  'RL_EXT_CALL_GITHUB_L3_PER_MIN_MAIN': 2,
  'RL_EXT_CALL_GITHUB_L1_PER_MIN_DEVELOPER': 20,
  'RL_EXT_CALL_GITHUB_L2_PER_MIN_DEVELOPER': 10,
  'RL_EXT_CALL_GITHUB_L3_PER_MIN_DEVELOPER': 0,
  'RL_EXT_CALL_GITHUB_L1_PER_MIN_SECURITY': 20,
  'RL_EXT_CALL_GITHUB_L2_PER_MIN_SECURITY': 0,
  'RL_EXT_CALL_GITHUB_L3_PER_MIN_SECURITY': 0,

  // Cloud logs ext_call
  'RL_EXT_CALL_CLOUD_LOGS_L1_PER_MIN_MAIN': 20,
  'RL_EXT_CALL_CLOUD_LOGS_L1_PER_MIN_SECURITY': 20,
  'RL_EXT_CALL_CLOUD_LOGS_L1_PER_MIN_DEVELOPER': 10,

  // Embeddings
  'RL_EMBED_OPENAI_PER_MIN_MAIN': 120,
  'RL_EMBED_OPENAI_PER_MIN_DEVELOPER': 60,
  'RL_EMBED_OPENAI_PER_MIN_SECURITY': 30,
};

// --- Quota defaults (daily: soft, hard) ---

const QUOTA_DEFAULTS: Record<string, [number, number]> = {
  // GitHub ext_call: [soft, hard]
  'QUOTA_EXT_CALL_GITHUB_L1_MAIN': [800, 1200],
  'QUOTA_EXT_CALL_GITHUB_L2_MAIN': [250, 350],
  'QUOTA_EXT_CALL_GITHUB_L3_MAIN': [10, 15],
  'QUOTA_EXT_CALL_GITHUB_L1_DEVELOPER': [500, 700],
  'QUOTA_EXT_CALL_GITHUB_L2_DEVELOPER': [150, 220],
  'QUOTA_EXT_CALL_GITHUB_L3_DEVELOPER': [0, 0],
  'QUOTA_EXT_CALL_GITHUB_L1_SECURITY': [500, 700],
  'QUOTA_EXT_CALL_GITHUB_L2_SECURITY': [0, 0],
  'QUOTA_EXT_CALL_GITHUB_L3_SECURITY': [0, 0],

  // Cloud logs ext_call
  'QUOTA_EXT_CALL_CLOUD_LOGS_L1_MAIN': [300, 450],
  'QUOTA_EXT_CALL_CLOUD_LOGS_L1_SECURITY': [300, 450],
  'QUOTA_EXT_CALL_CLOUD_LOGS_L1_DEVELOPER': [150, 220],

  // Embeddings (OpenAI)
  'QUOTA_EMBED_OPENAI_MAIN': [10000, 15000],
  'QUOTA_EMBED_OPENAI_DEVELOPER': [5000, 8000],
  'QUOTA_EMBED_OPENAI_SECURITY': [2000, 3000],
};

// --- Public API ---

/**
 * Get rate limit (per minute) for an operation.
 * @param op - 'gov_transition' | 'gov_approve' | 'ext_call' | 'embed'
 * @param group - 'main' | 'developer' | 'security' | ...
 * @param provider - e.g. 'github', 'cloud-logs', 'openai'
 * @param level - e.g. 'L1', 'L2', 'L3' (for ext_call)
 */
export function getRateLimit(
  op: string,
  group: string,
  provider?: string,
  level?: string,
): number {
  const g = group.toUpperCase();
  let envKey: string;

  if (op === 'gov_transition') {
    envKey = `RL_GOV_TRANSITION_PER_MIN_${g}`;
  } else if (op === 'gov_approve') {
    envKey = `RL_GOV_APPROVE_PER_MIN_${g}`;
  } else if (op === 'cockpit_write') {
    envKey = 'RL_COCKPIT_WRITE_PER_MIN';
  } else if (op === 'cockpit_login') {
    envKey = 'RL_COCKPIT_LOGIN_PER_MIN';
  } else if (op === 'ext_call' && provider && level) {
    const p = provider.toUpperCase().replace(/-/g, '_');
    envKey = `RL_EXT_CALL_${p}_${level.toUpperCase()}_PER_MIN_${g}`;
  } else if (op === 'embed' && provider) {
    const p = provider.toUpperCase().replace(/-/g, '_');
    envKey = `RL_EMBED_${p}_PER_MIN_${g}`;
  } else {
    return 30; // conservative fallback
  }

  return intEnv(envKey, RATE_LIMIT_DEFAULTS[envKey] ?? 30);
}

/**
 * Get daily quota { soft, hard } for an operation.
 */
export function getQuotaLimits(
  op: string,
  group: string,
  provider?: string,
  level?: string,
): { soft: number; hard: number } {
  const g = group.toUpperCase();
  let baseKey: string;

  if (op === 'ext_call' && provider && level) {
    const p = provider.toUpperCase().replace(/-/g, '_');
    baseKey = `QUOTA_EXT_CALL_${p}_${level.toUpperCase()}_${g}`;
  } else if (op === 'embed' && provider) {
    const p = provider.toUpperCase().replace(/-/g, '_');
    baseKey = `QUOTA_EMBED_${p}_${g}`;
  } else {
    // Gov ops don't have daily quotas by default — return unlimited
    return { soft: Number.MAX_SAFE_INTEGER, hard: Number.MAX_SAFE_INTEGER };
  }

  const defaults = QUOTA_DEFAULTS[baseKey] ?? [1000, 1500];
  return {
    soft: intEnv(`${baseKey}_SOFT`, defaults[0]),
    hard: intEnv(`${baseKey}_HARD`, defaults[1]),
  };
}

/**
 * Build scope key for DB lookups.
 */
export function buildScopeKey(
  group: string,
  provider?: string,
  level?: string,
): string {
  const parts = [group];
  if (provider) parts.push(provider);
  if (level) parts.push(level);
  return parts.join(':');
}

// --- Helper ---

function intEnv(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
