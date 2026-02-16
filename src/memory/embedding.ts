/**
 * Embedding engine — optional, behind OPENAI_API_KEY env var.
 * Provides cosine similarity for semantic recall.
 * Falls back to null when embeddings are disabled.
 *
 * Env vars:
 *   OPENAI_API_KEY (or legacy EMBEDDING_API_KEY)
 *   OPENAI_EMBED_MODEL  (default: text-embedding-3-small)
 *   EMBED_VECTOR_DIMS   (default: 1536)
 */

import { recordFailure, recordSuccess } from '../limits/breaker.js';
import { enforceEmbedLimits } from '../limits/enforce.js';

// --- Env-driven config (read at call time, not import time) ---

export function getEmbeddingApiKey(): string {
  return process.env.OPENAI_API_KEY || process.env.EMBEDDING_API_KEY || '';
}
export function getEmbeddingModel(): string {
  return process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
}
export function getEmbeddingDims(): number {
  return parseInt(process.env.EMBED_VECTOR_DIMS || '1536', 10);
}
export function embeddingEnabled(): boolean {
  return getEmbeddingApiKey().length > 0;
}

/** @deprecated Kept for backward compat in existing tests. Use embeddingEnabled(). */
export const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '';
export const EMBEDDING_ENABLED = EMBEDDING_API_KEY.length > 0;
export const EMBEDDING_DIM = 1536;

/**
 * Compute embedding for text via OpenAI API.
 * Returns null if embeddings are disabled, if level is L3
 * (L3 content never leaves the host, even in vectorized form),
 * or if rate/quota/breaker limits deny the call (fallback to keyword search).
 *
 * @param group - group folder for limit enforcement (optional for backward compat)
 */
export async function computeEmbedding(
  text: string,
  level?: string,
  group?: string,
): Promise<Float32Array | null> {
  if (!embeddingEnabled()) return null;
  if (level === 'L3') return null; // L3 never sent externally

  // Enforce embed limits (rate limit + quota + breaker)
  // If denied, return null → caller falls back to keyword search
  if (group) {
    const limitResult = enforceEmbedLimits(group, 'openai');
    if (!limitResult.allowed) {
      return null;
    }
  }

  const apiKey = getEmbeddingApiKey();
  const model = getEmbeddingModel();

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });

  if (!response.ok) {
    if (group) recordFailure('openai');
    return null;
  }

  if (group) recordSuccess('openai');
  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return new Float32Array(data.data[0].embedding);
}

/** Serialize a Float32Array to a Buffer for SQLite BLOB storage. */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/** Deserialize a Buffer from SQLite BLOB back to Float32Array. */
export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(
    buf.buffer,
    buf.byteOffset,
    buf.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

/**
 * Cosine similarity between two vectors.
 * Returns value in [-1, 1]: 1 = identical, 0 = orthogonal, -1 = opposite.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}
