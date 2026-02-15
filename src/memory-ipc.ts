/**
 * Memory IPC handler — host-side processing of mem_store and mem_recall requests.
 * Follows src/ext-broker.ts pattern.
 */
import crypto from 'crypto';

import { POLICY_VERSION } from './governance/policy-version.js';
import { storeMemory } from './memory-db.js';
import { classifyMemory } from './memory/classifier.js';
import type { MemoryLevel } from './memory/constants.js';
import { computeEmbedding, embeddingToBuffer } from './memory/embedding.js';
import { scanForInjection } from './memory/injection-guard.js';
import { scanAndSanitize } from './memory/pii-guard.js';
import { recallRelevantMemory } from './memory/recall.js';
import { logger } from './logger.js';

export interface MemoryIpcData {
  type: string;
  request_id?: string;
  // mem_store
  content?: string;
  level?: string;
  tags?: string[];
  source_ref?: string;
  scope?: string;
  product_id?: string;
  // mem_recall
  query?: string;
  limit?: number;
  // common
  timestamp?: string;
}

export interface MemoryIpcResponse {
  request_id: string;
  status: 'ok' | 'error' | 'denied';
  data?: unknown;
  error?: string;
}

/**
 * Process a memory IPC request (mem_store or mem_recall).
 * Returns a response object for the container.
 */
export async function processMemoryIpc(
  data: MemoryIpcData,
  sourceGroup: string,
  isMain: boolean,
): Promise<MemoryIpcResponse> {
  const requestId =
    data.request_id || crypto.randomUUID();

  try {
    switch (data.type) {
      case 'mem_store':
        return await handleMemStore(data, sourceGroup, isMain, requestId);
      case 'mem_recall':
        return handleMemRecall(data, sourceGroup, isMain, requestId);
      default:
        return {
          request_id: requestId,
          status: 'error',
          error: `Unknown memory IPC type: ${data.type}`,
        };
    }
  } catch (err) {
    logger.error({ err, type: data.type }, 'Memory IPC error');
    return {
      request_id: requestId,
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function handleMemStore(
  data: MemoryIpcData,
  sourceGroup: string,
  isMain: boolean,
  requestId: string,
): Promise<MemoryIpcResponse> {
  if (!data.content) {
    return {
      request_id: requestId,
      status: 'error',
      error: 'Missing content field',
    };
  }

  // Non-main cannot store L3
  if (data.level === 'L3' && !isMain) {
    return {
      request_id: requestId,
      status: 'denied',
      error: 'Only main group can store L3 memories',
    };
  }

  // 1. PII scan
  const piiResult = scanAndSanitize(data.content);

  // 2. Injection scan
  const injectionResult = scanForInjection(data.content);
  if (injectionResult.is_suspicious) {
    logger.warn(
      {
        group: sourceGroup,
        triggers: injectionResult.triggers,
        risk_score: injectionResult.risk_score,
      },
      'Injection detected in memory content',
    );
  }

  // 3. Classify
  const scope = data.scope || 'COMPANY';
  const classification = classifyMemory({
    content: data.content,
    piiResult,
    scope,
    explicit_level: data.level as MemoryLevel | undefined,
  });

  // 4. Compute embedding (optional, async — L3 excluded: never sent externally)
  const embedding = await computeEmbedding(piiResult.sanitized, classification.level);

  // 5. Store
  const memoryId = requestId;
  const now = new Date().toISOString();

  storeMemory({
    id: memoryId,
    content: piiResult.sanitized,
    content_hash: piiResult.original_hash,
    level: classification.level,
    scope,
    product_id: data.product_id ?? null,
    group_folder: sourceGroup,
    tags: data.tags ? JSON.stringify(data.tags) : null,
    pii_detected: piiResult.has_pii ? 1 : 0,
    pii_types: piiResult.pii_types.length > 0 ? JSON.stringify(piiResult.pii_types) : null,
    source_type: 'agent',
    source_ref: data.source_ref ?? null,
    policy_version: POLICY_VERSION,
    created_at: now,
    updated_at: now,
  });

  return {
    request_id: requestId,
    status: 'ok',
    data: {
      memory_id: memoryId,
      level: classification.level,
      classification_reason: classification.reason,
      pii_detected: piiResult.has_pii,
      injection_detected: injectionResult.is_suspicious,
      has_embedding: embedding !== null,
    },
  };
}

function handleMemRecall(
  data: MemoryIpcData,
  sourceGroup: string,
  isMain: boolean,
  requestId: string,
): MemoryIpcResponse {
  if (!data.query) {
    return {
      request_id: requestId,
      status: 'error',
      error: 'Missing query field',
    };
  }

  const result = recallRelevantMemory({
    query: data.query,
    accessor_group: sourceGroup,
    accessor_is_main: isMain,
    scope: data.scope || 'COMPANY',
    product_id: data.product_id ?? null,
    limit: data.limit,
  });

  return {
    request_id: requestId,
    status: 'ok',
    data: {
      memories: result.memories.map((m) => ({
        id: m.id,
        content: m.content,
        level: m.level,
        scope: m.scope,
        product_id: m.product_id,
        tags: m.tags,
        score: m.score,
        source_ref: m.source_ref,
        created_at: m.created_at,
      })),
      total_considered: result.total_considered,
      access_denials: result.access_denials,
    },
  };
}
