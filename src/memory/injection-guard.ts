/**
 * Prompt injection detection for stored memories.
 * Scans content for patterns that could manipulate agent behavior
 * when injected into dispatch prompts.
 */

export interface InjectionPattern {
  name: string;
  pattern: RegExp;
  weight: number; // 0.0-1.0 contribution to risk score
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    name: 'role_override',
    pattern: /(?:system|assistant|human)\s*:/gi,
    weight: 0.4,
  },
  {
    name: 'instruction_override',
    pattern:
      /ignore\s+(?:(?:all|the)\s+)?(?:previous|above|prior)\s+(?:instructions|prompt|rules|context)/gi,
    weight: 0.8,
  },
  {
    name: 'new_instructions',
    pattern: /(?:new|updated|revised)\s+(?:instructions|rules|prompt)\s*:/gi,
    weight: 0.6,
  },
  {
    name: 'xml_tag_injection',
    pattern: /<\/?(?:system|prompt|assistant|tool_call|function_call|im_start|im_end)>/gi,
    weight: 0.7,
  },
  {
    name: 'prompt_template',
    pattern: /<<\s*SYS\s*>>|\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/gi,
    weight: 0.8,
  },
  {
    name: 'identity_manipulation',
    pattern:
      /you\s+are\s+(?:now|no\s+longer|not|actually|really)\s/gi,
    weight: 0.5,
  },
  {
    name: 'tool_injection',
    pattern:
      /(?:execute|run|call)\s+(?:tool|function|command)\s*[:=]/gi,
    weight: 0.6,
  },
  {
    name: 'output_manipulation',
    pattern:
      /(?:respond|reply|output|print|say)\s+(?:only|exactly|with)\s*[:=]?\s*['"]/gi,
    weight: 0.5,
  },
];

export interface InjectionScanResult {
  is_suspicious: boolean;
  risk_score: number; // 0.0-1.0
  triggers: string[];
  sanitized: string;
}

/**
 * Scan content for prompt injection patterns.
 * Returns risk score and sanitized version wrapped in safe tags.
 */
export function scanForInjection(content: string): InjectionScanResult {
  const triggers: string[] = [];
  let maxWeight = 0;

  for (const { name, pattern, weight } of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      triggers.push(name);
      if (weight > maxWeight) maxWeight = weight;
    }
  }

  // Risk score: highest single pattern weight, capped at 1.0
  const risk_score = Math.min(maxWeight, 1.0);
  const is_suspicious = triggers.length > 0;

  // Sanitize: escape internal XML-like tags and wrap in safe delimiters
  let sanitized = content;
  if (is_suspicious) {
    sanitized = content
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    sanitized = `<user_memory>\n${sanitized}\n</user_memory>`;
  }

  return {
    is_suspicious,
    risk_score,
    triggers,
    sanitized,
  };
}
