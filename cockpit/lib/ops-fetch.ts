/**
 * Server-side proxy helper — injects OS_HTTP_SECRET, never exposed to client.
 */
const HOST_URL = process.env.OS_HOST_URL || 'http://localhost:7700';
const SECRET = process.env.OS_HTTP_SECRET || '';

export async function opsFetch<T = unknown>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, HOST_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { 'X-OS-SECRET': SECRET },
    next: { revalidate: 5 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OPS ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}
