/**
 * Security Module for NanoClaw
 *
 * Centralized security controls for the NanoClaw system:
 * - Input sanitization and validation
 * - Shell command deny patterns (for agent containers)
 * - Secret detection to prevent accidental exposure
 * - Rate limiting for channels
 * - Docker security configuration
 *
 * Design: Defense-in-depth approach. Even if one layer fails,
 * container isolation provides the ultimate boundary.
 */
import { logger } from './logger.js';

/**
 * Patterns that should NEVER appear in shell commands executed by agents.
 * These are checked inside agent containers as an additional safety layer.
 */
export const SHELL_DENY_PATTERNS: RegExp[] = [
  /\brm\s+-[rf]{1,2}\s+\//,           // rm -rf /
  /\b(format|mkfs|diskpart)\b/i,       // Disk formatting
  /\bdd\s+if=/,                        // Raw disk write
  /:\(\)\s*\{.*\};\s*:/,               // Fork bomb
  /\b(shutdown|reboot|poweroff)\b/i,   // System power
  /\bchmod\s+777\s+\//,               // Dangerous chmod on root
  /\bcurl\b.*\|\s*\bbash\b/,          // Pipe curl to bash
  /\bwget\b.*\|\s*\bbash\b/,          // Pipe wget to bash
  />(\/dev\/sd|\/dev\/nvme)/,          // Write to raw devices
  /\biptables\s+-F/,                    // Flush firewall rules
  /\bpasswd\b/,                         // Password changes
  /\buseradd\b/,                        // User creation
  /\bchown\s+-R\s+.*\//,              // Recursive chown on root
];

/**
 * Check if a command matches any deny pattern.
 * Returns the matched pattern description or null if safe.
 */
export function checkShellCommand(command: string): string | null {
  for (const pattern of SHELL_DENY_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked by security pattern: ${pattern.source}`;
    }
  }
  return null;
}

/**
 * Patterns that indicate secrets/credentials in text.
 * Used to prevent accidental logging or exposure.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/,             // API keys (generic)
  /\b(ghp_[a-zA-Z0-9]{36})\b/,              // GitHub personal access tokens
  /\b(gho_[a-zA-Z0-9]{36})\b/,              // GitHub OAuth tokens
  /\b(xox[bprs]-[a-zA-Z0-9-]{10,})\b/,     // Slack tokens
  /\bAIza[a-zA-Z0-9_-]{35}\b/,              // Google API keys
  /\b(AKIA[A-Z0-9]{16})\b/,                 // AWS access keys
  /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/, // Private keys
  /-----BEGIN CERTIFICATE-----/,              // Certificates (warn only)
];

/**
 * Scan text for potential secrets.
 * Returns list of detected secret types.
 */
export function detectSecrets(text: string): string[] {
  const found: string[] = [];

  const descriptions = [
    'API key',
    'GitHub personal access token',
    'GitHub OAuth token',
    'Slack token',
    'Google API key',
    'AWS access key',
    'Private key',
    'Certificate',
  ];

  for (let i = 0; i < SECRET_PATTERNS.length; i++) {
    if (SECRET_PATTERNS[i].test(text)) {
      found.push(descriptions[i]);
    }
  }

  return found;
}

/**
 * Redact secrets from text for safe logging.
 */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

/**
 * Sanitize a container name to prevent command injection.
 * Only allows alphanumeric characters and hyphens.
 */
export function sanitizeContainerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, '');
}

/**
 * Validate environment variables before passing to containers.
 * Only allows explicitly listed variable names.
 */
const ALLOWED_ENV_VARS = new Set([
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'NODE_ENV',
  'TZ',
]);

export function filterEnvVars(
  env: Record<string, string>,
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (ALLOWED_ENV_VARS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Simple rate limiter for channel messages.
 * Prevents abuse from external channels.
 */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 30, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /** Check if a request should be allowed. Returns true if allowed. */
  check(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window || now >= window.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (window.count >= this.maxRequests) {
      logger.warn({ key, count: window.count }, 'Rate limit exceeded');
      return false;
    }

    window.count++;
    return true;
  }

  /** Clean up expired windows */
  cleanup(): void {
    const now = Date.now();
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) {
        this.windows.delete(key);
      }
    }
  }
}

/**
 * Docker security flags for agent containers.
 * Applied when spawning containers to limit attack surface.
 */
export function getDockerSecurityArgs(): string[] {
  return [
    // No network access (agents communicate via filesystem IPC)
    '--network=none',
    // Drop all capabilities
    '--cap-drop=ALL',
    // No new privileges
    '--security-opt=no-new-privileges:true',
    // Read-only root filesystem (writable mounts are explicit)
    '--read-only',
    // Limit memory to prevent DoS
    '--memory=1g',
    '--memory-swap=1g',
    // Limit CPU
    '--cpus=1.0',
    // Limit PIDs to prevent fork bombs
    '--pids-limit=256',
    // Tmpfs for /tmp (writable, but in-memory and limited)
    '--tmpfs=/tmp:rw,noexec,nosuid,size=256m',
  ];
}

/**
 * Validate a URL to prevent SSRF attacks.
 * Only allows http:// and https:// schemes.
 */
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sanitize user input to prevent injection in XML-formatted prompts.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
