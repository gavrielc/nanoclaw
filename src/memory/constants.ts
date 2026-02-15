/**
 * Memory system constants and types.
 * Follows src/governance/constants.ts pattern.
 */

export const MemoryLevels = ['L0', 'L1', 'L2', 'L3'] as const;
export type MemoryLevel = (typeof MemoryLevels)[number];
// L0 = public (any group, any product)
// L1 = operational (owner group + main)
// L2 = product-internal (product-scoped groups + main)
// L3 = sensitive (main only, audit-logged on every access)

export const MemorySourceTypes = ['agent', 'dispatch', 'system'] as const;
export type MemorySourceType = (typeof MemorySourceTypes)[number];

export interface Memory {
  id: string;
  content: string; // sanitized text (PII removed)
  content_hash: string; // SHA-256 of original content
  level: MemoryLevel;
  scope: string; // 'COMPANY' | 'PRODUCT'
  product_id: string | null;
  group_folder: string; // creator group
  tags: string | null; // JSON array of keyword tags
  pii_detected: number; // 0 or 1
  pii_types: string | null; // JSON array of detected PII types
  source_type: string;
  source_ref: string | null; // task_id, etc.
  policy_version: string | null;
  created_at: string;
  updated_at: string;
  version: number; // optimistic locking
}

export interface MemoryAccessLog {
  memory_id: string;
  accessor_group: string;
  access_type: string; // 'read' | 'recall' | 'search'
  granted: number; // 0=denied, 1=granted
  reason: string | null;
  created_at: string;
}
