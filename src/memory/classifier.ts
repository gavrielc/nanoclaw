/**
 * Memory classification engine.
 * Determines the security level (L0-L3) for a memory based on content, PII scan, and scope.
 */
import type { MemoryLevel } from './constants.js';
import type { PiiScanResult } from './pii-guard.js';

const LEVEL_ORDER: Record<MemoryLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

export interface ClassificationResult {
  level: MemoryLevel;
  reason: string;
  auto_classified: boolean;
}

export interface ClassificationInput {
  content: string;
  piiResult: PiiScanResult;
  scope: string;
  explicit_level?: MemoryLevel;
}

/**
 * Classify a memory's security level.
 *
 * Rules (in priority order):
 * 1. If explicit_level provided → use it (auto_classified=false)
 * 2. If PII detected → L3 minimum
 * 3. If scope=PRODUCT → L2 minimum
 * 4. Otherwise → L1 (default operational)
 * 5. Never downgrade: max(explicit, auto)
 */
export function classifyMemory(input: ClassificationInput): ClassificationResult {
  let autoLevel: MemoryLevel = 'L1';
  let reason = 'default operational level';

  // PII → L3 minimum
  if (input.piiResult.has_pii) {
    autoLevel = 'L3';
    reason = `PII detected: ${input.piiResult.pii_types.join(', ')}`;
  }
  // PRODUCT scope → L2 minimum (if not already higher)
  else if (input.scope === 'PRODUCT') {
    autoLevel = 'L2';
    reason = 'product-scoped memory';
  }

  // If explicit level provided, use max(explicit, auto) — never downgrade
  if (input.explicit_level) {
    const explicitOrd = LEVEL_ORDER[input.explicit_level];
    const autoOrd = LEVEL_ORDER[autoLevel];

    if (explicitOrd >= autoOrd) {
      return {
        level: input.explicit_level,
        reason: `explicit level ${input.explicit_level}`,
        auto_classified: false,
      };
    }

    // Auto level is higher — upgrade to protect PII/scope
    return {
      level: autoLevel,
      reason: `upgraded from ${input.explicit_level} to ${autoLevel}: ${reason}`,
      auto_classified: true,
    };
  }

  return {
    level: autoLevel,
    reason,
    auto_classified: true,
  };
}
