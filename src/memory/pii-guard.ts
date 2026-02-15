/**
 * PII detection and sanitization.
 * Scans content for personally identifiable information and secrets,
 * replaces with redaction markers, returns SHA-256 hash of original.
 */
import crypto from 'crypto';

export interface PiiPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

// Order matters: more specific patterns first to avoid generic patterns consuming them
export const PII_PATTERNS: PiiPattern[] = [
  {
    name: 'jwt',
    pattern:
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replacement: '[JWT_REDACTED]',
  },
  {
    name: 'api_key',
    pattern:
      /(?:sk-|pk_live_|pk_test_|rk_live_|rk_test_|ghp_|gho_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{16,}/g,
    replacement: '[API_KEY_REDACTED]',
  },
  {
    name: 'aws_key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[AWS_KEY_REDACTED]',
  },
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[A-Za-z0-9_.\-/+=]{20,}/gi,
    replacement: 'Bearer [TOKEN_REDACTED]',
  },
  {
    name: 'generic_secret',
    pattern:
      /(?:password|secret|token|api_key|apikey)\s*[:=]\s*['"]?(?!\[)[^\s'"]{8,}/gi,
    replacement: '[SECRET_REDACTED]',
  },
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_REDACTED]',
  },
  {
    name: 'credit_card',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: '[CC_REDACTED]',
  },
  {
    name: 'phone',
    pattern:
      /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
    replacement: '[PHONE_REDACTED]',
  },
  {
    name: 'ip_address',
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    replacement: '[IP_REDACTED]',
  },
  {
    name: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN_REDACTED]',
  },
];

export interface PiiScanResult {
  has_pii: boolean;
  pii_types: string[];
  sanitized: string;
  original_hash: string;
}

export function scanAndSanitize(content: string): PiiScanResult {
  const original_hash = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');

  const detectedTypes = new Set<string>();
  let sanitized = content;

  for (const { name, pattern, replacement } of PII_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      detectedTypes.add(name);
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, replacement);
    }
  }

  return {
    has_pii: detectedTypes.size > 0,
    pii_types: [...detectedTypes].sort(),
    sanitized,
    original_hash,
  };
}
