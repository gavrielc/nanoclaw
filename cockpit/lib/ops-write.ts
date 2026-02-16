/**
 * Server-side POST proxy — injects dual secrets, never exposed to client.
 */
const HOST_URL = process.env.OS_HOST_URL || 'http://localhost:7700';
const READ_SECRET = process.env.OS_HTTP_SECRET || '';
const WRITE_SECRET = process.env.COCKPIT_WRITE_SECRET_CURRENT
  || process.env.COCKPIT_WRITE_SECRET || '';

export async function opsWrite<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = new URL(path, HOST_URL);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OS-SECRET': READ_SECRET,
      'X-WRITE-SECRET': WRITE_SECRET,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error || `OPS ${res.status}`;
    const err = new Error(msg);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }

  return data as T;
}
