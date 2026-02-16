import { createHmac } from 'crypto';
import { cookies } from 'next/headers';

const SESSION_SECRET = process.env.COCKPIT_SESSION_SECRET || '';
const CSRF_SECRET = process.env.COCKPIT_CSRF_SECRET || '';
const COOKIE_NAME = 'nc_session';

function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function signSession(sessionId: string): string {
  const sig = hmac(SESSION_SECRET, sessionId);
  return `${sessionId}.${sig}`;
}

export function verifySession(cookie: string): string | null {
  if (!SESSION_SECRET) return null;
  const dot = cookie.lastIndexOf('.');
  if (dot < 1) return null;
  const sessionId = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = hmac(SESSION_SECRET, sessionId);
  if (sig !== expected) return null;
  return sessionId;
}

export function generateCsrfToken(sessionId: string): string {
  return hmac(CSRF_SECRET, sessionId);
}

export function verifyCsrfToken(sessionId: string, token: string): boolean {
  if (!CSRF_SECRET) return false;
  return generateCsrfToken(sessionId) === token;
}

export async function getSession(): Promise<string | null> {
  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  return verifySession(cookie);
}

export { COOKIE_NAME };
