import { describe, it, expect } from 'vitest';
import { scanAndSanitize } from './pii-guard.js';

describe('PII guard', () => {
  it('detects email addresses', () => {
    const result = scanAndSanitize('Contact user@example.com for details');
    expect(result.has_pii).toBe(true);
    expect(result.pii_types).toContain('email');
    expect(result.sanitized).toContain('[EMAIL_REDACTED]');
    expect(result.sanitized).not.toContain('user@example.com');
  });

  it('detects phone numbers', () => {
    const result = scanAndSanitize('Call 555-123-4567 or (555) 234-5678');
    expect(result.has_pii).toBe(true);
    expect(result.pii_types).toContain('phone');
    expect(result.sanitized).toContain('[PHONE_REDACTED]');
  });

  it('detects credit card numbers', () => {
    const result = scanAndSanitize('Card: 4111-1111-1111-1111');
    expect(result.has_pii).toBe(true);
    expect(result.pii_types).toContain('credit_card');
    expect(result.sanitized).toContain('[CC_REDACTED]');
  });

  it('detects JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = scanAndSanitize(`Token: ${jwt}`);
    expect(result.has_pii).toBe(true);
    expect(result.pii_types).toContain('jwt');
    expect(result.sanitized).toContain('[JWT_REDACTED]');
  });

  it('detects API keys (GitHub, Stripe, etc.)', () => {
    const result = scanAndSanitize(
      'Use ghp_ABCDEFGHIJKLMNOPqrstuvwxyz1234 for auth',
    );
    expect(result.has_pii).toBe(true);
    expect(result.pii_types).toContain('api_key');
    expect(result.sanitized).toContain('[API_KEY_REDACTED]');
  });

  it('detects AWS access keys', () => {
    const result = scanAndSanitize('AWS key: AKIAIOSFODNN7EXAMPLE');
    expect(result.has_pii).toBe(true);
    expect(result.pii_types).toContain('aws_key');
    expect(result.sanitized).toContain('[AWS_KEY_REDACTED]');
  });

  it('detects bearer tokens', () => {
    const result = scanAndSanitize(
      'Authorization: Bearer abc123def456ghi789jkl012mno345',
    );
    expect(result.has_pii).toBe(true);
    expect(result.pii_types).toContain('bearer_token');
    expect(result.sanitized).toContain('Bearer [TOKEN_REDACTED]');
  });

  it('detects generic secrets', () => {
    const result = scanAndSanitize('password=mysupersecretpassword123');
    expect(result.has_pii).toBe(true);
    expect(result.pii_types).toContain('generic_secret');
    expect(result.sanitized).toContain('[SECRET_REDACTED]');
  });

  it('detects multiple PII types in mixed content', () => {
    const result = scanAndSanitize(
      'Contact user@test.com, card 4111-1111-1111-1111, key AKIAIOSFODNN7EXAMPLE',
    );
    expect(result.has_pii).toBe(true);
    expect(result.pii_types.length).toBeGreaterThanOrEqual(3);
    expect(result.pii_types).toContain('email');
    expect(result.pii_types).toContain('credit_card');
    expect(result.pii_types).toContain('aws_key');
  });

  it('returns clean result for safe content', () => {
    const result = scanAndSanitize(
      'This is a normal business discussion about quarterly targets.',
    );
    expect(result.has_pii).toBe(false);
    expect(result.pii_types).toEqual([]);
    expect(result.sanitized).toBe(
      'This is a normal business discussion about quarterly targets.',
    );
  });

  it('computes SHA-256 hash of original content', () => {
    const content = 'secret@email.com';
    const result = scanAndSanitize(content);
    expect(result.original_hash).toMatch(/^[a-f0-9]{64}$/);
    // Hash is deterministic
    const result2 = scanAndSanitize(content);
    expect(result2.original_hash).toBe(result.original_hash);
  });
});
