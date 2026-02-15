import { describe, it, expect } from 'vitest';
import { classifyMemory } from './classifier.js';
import type { PiiScanResult } from './pii-guard.js';

const cleanPii: PiiScanResult = {
  has_pii: false,
  pii_types: [],
  sanitized: 'clean content',
  original_hash: 'abc',
};

const piiDetected: PiiScanResult = {
  has_pii: true,
  pii_types: ['email', 'phone'],
  sanitized: '[EMAIL_REDACTED] [PHONE_REDACTED]',
  original_hash: 'def',
};

describe('memory classifier', () => {
  it('defaults to L1 for COMPANY scope without PII', () => {
    const result = classifyMemory({
      content: 'Regular business note',
      piiResult: cleanPii,
      scope: 'COMPANY',
    });
    expect(result.level).toBe('L1');
    expect(result.auto_classified).toBe(true);
  });

  it('classifies PRODUCT scope as L2 minimum', () => {
    const result = classifyMemory({
      content: 'Product strategy',
      piiResult: cleanPii,
      scope: 'PRODUCT',
    });
    expect(result.level).toBe('L2');
    expect(result.auto_classified).toBe(true);
    expect(result.reason).toContain('product-scoped');
  });

  it('classifies PII content as L3', () => {
    const result = classifyMemory({
      content: 'user@example.com',
      piiResult: piiDetected,
      scope: 'COMPANY',
    });
    expect(result.level).toBe('L3');
    expect(result.auto_classified).toBe(true);
    expect(result.reason).toContain('PII');
  });

  it('respects explicit level when higher than auto', () => {
    const result = classifyMemory({
      content: 'Nothing special',
      piiResult: cleanPii,
      scope: 'COMPANY',
      explicit_level: 'L3',
    });
    expect(result.level).toBe('L3');
    expect(result.auto_classified).toBe(false);
  });

  it('respects explicit level when equal to auto', () => {
    const result = classifyMemory({
      content: 'Product info',
      piiResult: cleanPii,
      scope: 'PRODUCT',
      explicit_level: 'L2',
    });
    expect(result.level).toBe('L2');
    expect(result.auto_classified).toBe(false);
  });

  it('never downgrades: PII overrides explicit L0', () => {
    const result = classifyMemory({
      content: 'user@example.com',
      piiResult: piiDetected,
      scope: 'COMPANY',
      explicit_level: 'L0',
    });
    expect(result.level).toBe('L3');
    expect(result.auto_classified).toBe(true);
    expect(result.reason).toContain('upgraded');
  });

  it('never downgrades: PRODUCT scope overrides explicit L0', () => {
    const result = classifyMemory({
      content: 'Product specific',
      piiResult: cleanPii,
      scope: 'PRODUCT',
      explicit_level: 'L0',
    });
    expect(result.level).toBe('L2');
    expect(result.auto_classified).toBe(true);
    expect(result.reason).toContain('upgraded');
  });

  it('PII takes precedence over PRODUCT scope', () => {
    const result = classifyMemory({
      content: 'user@example.com product data',
      piiResult: piiDetected,
      scope: 'PRODUCT',
    });
    expect(result.level).toBe('L3');
  });
});
