import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { signSession, generateCsrfToken, COOKIE_NAME } from '@/lib/auth';

const PASSWORD = process.env.COCKPIT_PASSWORD || '';

export async function POST(request: Request) {
  if (!PASSWORD) {
    return NextResponse.json(
      { error: 'Authentication not configured' },
      { status: 503 },
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.password !== PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const sessionId = randomUUID();
  const cookie = signSession(sessionId);
  const csrf = generateCsrfToken(sessionId);

  const isHttps = process.env.NODE_ENV === 'production'
    || request.headers.get('x-forwarded-proto') === 'https';

  const res = NextResponse.json({ ok: true, csrf });
  res.cookies.set(COOKIE_NAME, cookie, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 12, // 12 hours
  });

  return res;
}
