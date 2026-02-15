import { describe, it, expect } from 'vitest';
import { recommendModelTier, shouldEscalate } from './escalation-policy.js';

describe('escalation policy', () => {
  it('P0 priority escalates to deep', () => {
    expect(
      recommendModelTier({
        task_type: 'FEATURE',
        priority: 'P0',
        risk_level: 'normal',
        has_l3_memories: false,
      }),
    ).toBe('deep');
  });

  it('SECURITY task type escalates to deep', () => {
    expect(
      recommendModelTier({
        task_type: 'SECURITY',
        priority: 'P2',
        risk_level: 'normal',
        has_l3_memories: false,
      }),
    ).toBe('deep');
  });

  it('L3 memories involved escalates to deep', () => {
    expect(
      recommendModelTier({
        task_type: 'FEATURE',
        priority: 'P2',
        risk_level: 'normal',
        has_l3_memories: true,
      }),
    ).toBe('deep');
  });

  it('high risk level escalates to standard', () => {
    expect(
      recommendModelTier({
        task_type: 'FEATURE',
        priority: 'P2',
        risk_level: 'high',
        has_l3_memories: false,
      }),
    ).toBe('standard');
  });

  it('defaults to fast for normal tasks', () => {
    expect(
      recommendModelTier({
        task_type: 'FEATURE',
        priority: 'P2',
        risk_level: 'normal',
        has_l3_memories: false,
      }),
    ).toBe('fast');
  });

  it('auto-escalates fast → standard → deep on retries', () => {
    expect(shouldEscalate('fast', 0)).toBe('fast');
    expect(shouldEscalate('fast', 1)).toBe('standard');
    expect(shouldEscalate('standard', 1)).toBe('deep');
    expect(shouldEscalate('deep', 1)).toBe('deep'); // already max
  });
});
