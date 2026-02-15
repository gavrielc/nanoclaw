/**
 * Embedding engine — optional, behind EMBEDDING_API_KEY env var.
 * Provides cosine similarity for semantic recall.
 * Falls back to null when embeddings are disabled.
 */

export const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || '';
export const EMBEDDING_ENABLED = EMBEDDING_API_KEY.length > 0;
export const EMBEDDING_DIM = 1536; // text-embedding-3-small default

/**
 * Compute embedding for text via OpenAI API.
 * Returns null if embeddings are disabled or if level is L3
 * (L3 content never leaves the host, even in vectorized form).
 */
export async function computeEmbedding(
  text: string,
  level?: string,
): Promise<Float32Array | null> {
  if (!EMBEDDING_ENABLED) return null;
  if (level === 'L3') return null; // L3 never sent externally

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${EMBEDDING_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    return null;
  }

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
