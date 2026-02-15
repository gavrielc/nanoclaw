/**
 * Model escalation policy — determines which model tier to use
 * based on task metadata and memory context.
 */

export type ModelTier = 'fast' | 'standard' | 'deep';

const TIER_ORDER: Record<ModelTier, number> = {
  fast: 0,
  standard: 1,
  deep: 2,
};

const TIER_BY_ORDER: ModelTier[] = ['fast', 'standard', 'deep'];

export interface EscalationInput {
  task_type: string;
  priority: string;
  risk_level: string;
  has_l3_memories: boolean;
}

/**
 * Recommend a model tier based on task characteristics.
 *
 * Rules:
 * - P0 or SECURITY or INCIDENT → deep
 * - L3 memories involved → deep
 * - risk_level=high → standard minimum
 * - RESEARCH or EPIC → standard
 * - Otherwise → fast
 */
export function recommendModelTier(input: EscalationInput): ModelTier {
  // Critical tasks always get deep
  if (
    input.priority === 'P0' ||
    input.task_type === 'SECURITY' ||
    input.task_type === 'INCIDENT'
  ) {
    return 'deep';
  }

  // L3 memories require deep reasoning
  if (input.has_l3_memories) {
    return 'deep';
  }

  // High risk gets at least standard
  if (input.risk_level === 'high') {
    return 'standard';
  }

  // Complex task types get standard
  if (input.task_type === 'RESEARCH' || input.task_type === 'EPIC') {
    return 'standard';
  }

  return 'fast';
}

/**
 * Auto-escalate on failure: fast → standard → deep.
 * Returns the next tier up, or the same if already at max.
 */
export function shouldEscalate(
  currentTier: ModelTier,
  retryCount: number,
): ModelTier {
  if (retryCount === 0) return currentTier;

  const currentOrd = TIER_ORDER[currentTier];
  const nextOrd = Math.min(currentOrd + 1, TIER_BY_ORDER.length - 1);
  return TIER_BY_ORDER[nextOrd];
}
