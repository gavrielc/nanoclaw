/**
 * Shared helper: verify session + CSRF, parse body, proxy to host.
 */
import { NextResponse } from 'next/server';
import { getSession, verifyCsrfToken } from './auth';
import { opsWrite } from './ops-write';

export async function authenticatedWrite(
  request: Request,
  hostPath: string,
): Promise<NextResponse> {
  const sessionId = await getSession();
  if (!sessionId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const csrf = request.headers.get('x-csrf-token') || '';
  if (!verifyCsrfToken(sessionId, csrf)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const data = await opsWrite(hostPath, body);
    return NextResponse.json(data);
  } catch (err) {
    const status = (err as Error & { status?: number }).status || 502;
    const msg = err instanceof Error ? err.message : 'Write failed';
    return NextResponse.json({ error: msg }, { status });
  }
}
