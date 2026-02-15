/**
 * Scoped recall engine with access control.
 * Enforces L0-L3 visibility rules, product isolation, and L3 audit logging.
 */
import type { Memory, MemoryLevel } from './constants.js';
import {
  searchMemoriesByKeywords,
  logMemoryAccess,
  getMemoriesByGroup,
} from '../memory-db.js';

const LEVEL_ORDER: Record<MemoryLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

const LEVEL_BY_ORDER: MemoryLevel[] = ['L0', 'L1', 'L2', 'L3'];

export interface RecallQuery {
  query: string;
  accessor_group: string;
  accessor_is_main: boolean;
  scope: string; // 'COMPANY' | 'PRODUCT'
  product_id: string | null;
  max_level?: MemoryLevel;
  limit?: number; // default 10
}

export interface RecallResult {
  memories: Array<Memory & { score: number }>;
  total_considered: number;
  access_denials: number;
}

/**
 * Determine the maximum memory level an accessor can see for a given memory.
 *
 * Rules:
 * - L0: visible to all groups, all products
 * - L1: visible to owner group + main
 * - L2: visible to same product_id groups + main (product isolation)
 * - L3: visible to main only
 */
export function resolveMaxLevel(
  accessorGroup: string,
  isMain: boolean,
  memoryGroup: string,
  memoryScope: string,
  memoryProductId: string | null,
  accessorProductId: string | null,
): MemoryLevel {
  // Main can see everything
  if (isMain) return 'L3';

  // For PRODUCT-scoped memories, enforce product isolation first
  if (memoryScope === 'PRODUCT' && memoryProductId) {
    if (!accessorProductId || memoryProductId !== accessorProductId) {
      // Different product → L0 only (product isolation)
      return 'L0';
    }
    // Same product: owner group gets L2, others get L1
    if (accessorGroup === memoryGroup) return 'L2';
    return 'L1';
  }

  // COMPANY-scoped memories: owner group gets L2, others get L0
  if (accessorGroup === memoryGroup) return 'L2';
  return 'L0';
}

/**
 * Check if an accessor can see a memory at its current level.
 */
function canAccess(
  memory: Memory,
  accessorGroup: string,
  isMain: boolean,
  accessorProductId: string | null,
): boolean {
  const maxAllowed = resolveMaxLevel(
    accessorGroup,
    isMain,
    memory.group_folder,
    memory.scope,
    memory.product_id,
    accessorProductId,
  );
  return LEVEL_ORDER[memory.level as MemoryLevel] <= LEVEL_ORDER[maxAllowed];
}

/**
 * Extract keywords from a query string.
 * Splits on whitespace, filters short/common words.
 */
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'but', 'not',
    'with', 'from', 'by', 'as', 'it', 'its', 'this', 'that',
  ]);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 10); // limit keywords to prevent overly broad search
}

/**
 * Recall relevant memories with access control enforcement.
 */
export function recallRelevantMemory(query: RecallQuery): RecallResult {
  const limit = query.limit ?? 10;
  const now = new Date().toISOString();

  // Step 1: Keyword search
  const keywords = extractKeywords(query.query);
  let candidates: Memory[];

  if (keywords.length > 0) {
    // Search broadly — access control handles product isolation and level filtering.
    // This ensures denied access attempts are properly tracked in audit logs.
    candidates = searchMemoriesByKeywords(keywords, {
      limit: limit * 5, // over-fetch for access control filtering
    });
  } else {
    // No meaningful keywords — return recent group memories
    candidates = getMemoriesByGroup(query.accessor_group, limit * 3);
  }

  const total_considered = candidates.length;
  let access_denials = 0;

  // Step 2: Apply access control filter
  const accessible: Array<Memory & { score: number }> = [];

  for (const mem of candidates) {
    const memLevel = mem.level as MemoryLevel;

    // Audit L3 access attempts (regardless of outcome)
    if (LEVEL_ORDER[memLevel] >= LEVEL_ORDER['L3']) {
      const granted = canAccess(
        mem,
        query.accessor_group,
        query.accessor_is_main,
        query.product_id,
      );
      logMemoryAccess({
        memory_id: mem.id,
        accessor_group: query.accessor_group,
        access_type: 'recall',
        granted: granted ? 1 : 0,
        reason: granted ? null : 'L3_ACCESS_DENIED',
        created_at: now,
      });
      if (!granted) {
        access_denials++;
        continue;
      }
    } else if (
      !canAccess(
        mem,
        query.accessor_group,
        query.accessor_is_main,
        query.product_id,
      )
    ) {
      access_denials++;
      continue;
    }

    // Apply optional max_level filter
    if (query.max_level && LEVEL_ORDER[memLevel] > LEVEL_ORDER[query.max_level]) {
      continue;
    }

    // Score: simple keyword match count
    const matchCount = keywords.filter((kw) =>
      mem.content.toLowerCase().includes(kw),
    ).length;
    const score = keywords.length > 0 ? matchCount / keywords.length : 0.5;

    accessible.push({ ...mem, score });
  }

  // Step 3: Sort by score descending, limit
  accessible.sort((a, b) => b.score - a.score);

  return {
    memories: accessible.slice(0, limit),
    total_considered,
    access_denials,
  };
}
