/**
 * Shape checks for a pasted Anthropic credential. A subscription OAuth token
 * starts `sk-ant-oat`; any other `sk-ant-<type>` is an API key (the Console
 * issues api, usr and svc keys, and may add types), except an Admin API key,
 * which manages an organization and cannot call models.
 */
const OAUTH_PREFIX = 'sk-ant-oat';
const ADMIN_PREFIX = 'sk-ant-admin';
const KEY_PREFIX = /^sk-ant-[a-z]+/;

/** A pasted secret with every whitespace character removed, including a terminal's line wrap. */
export function pastedCredential(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, '');
}

export function isAnthropicOAuthToken(value: string): boolean {
  return value.startsWith(OAUTH_PREFIX);
}

/** The prompt's error for a pasted value, or `undefined` when it has the right shape. */
export function anthropicCredentialError(kind: 'api' | 'oauth', raw: string | undefined): string | undefined {
  const value = pastedCredential(raw);
  if (!value) return 'Required';
  if (kind === 'oauth') return isAnthropicOAuthToken(value) ? undefined : `Must start with ${OAUTH_PREFIX}`;
  if (isAnthropicOAuthToken(value)) return 'That is an OAuth token; choose "Paste an OAuth token" instead';
  if (value.startsWith(ADMIN_PREFIX)) return 'Admin API keys cannot call Claude; paste an API key instead';
  if (!KEY_PREFIX.test(value)) return 'Must be an Anthropic API key (sk-ant-api…, sk-ant-usr… or sk-ant-svc…)';
  return undefined;
}
