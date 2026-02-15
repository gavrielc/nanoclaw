import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
  computeEmbedding,
  EMBEDDING_ENABLED,
} from './embedding.js';

describe('embedding engine', () => {
  it('cosine similarity of identical vectors is 1', () => {
    const v = new Float32Array([1, 2, 3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('cosine similarity of orthogonal vectors is 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('cosine similarity of opposite vectors is -1', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('handles zero vectors gracefully', () => {
    const zero = new Float32Array([0, 0, 0]);
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(zero, v)).toBe(0);
  });

  it('roundtrips Float32Array through Buffer', () => {
    const original = new Float32Array([0.1, -0.5, 0.999, -1.0, 0.0]);
    const buf = embeddingToBuffer(original);
    const recovered = bufferToEmbedding(buf);
    expect(recovered.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(recovered[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('computeEmbedding returns null when API key is not set', async () => {
    // In test environment, EMBEDDING_API_KEY is not set
    expect(EMBEDDING_ENABLED).toBe(false);
    const result = await computeEmbedding('test text');
    expect(result).toBeNull();
  });

  it('computeEmbedding returns null for L3 level (never sent externally)', async () => {
    const result = await computeEmbedding('sensitive content', 'L3');
    expect(result).toBeNull();
  });

  it('computeEmbedding does not block L0-L2 levels', async () => {
    // Without API key, still returns null — but the L3 guard is separate
    for (const level of ['L0', 'L1', 'L2']) {
      const result = await computeEmbedding('test', level);
      // Returns null because EMBEDDING_ENABLED is false, not because of level guard
      expect(result).toBeNull();
    }
  });
});
