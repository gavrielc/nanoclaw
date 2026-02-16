import { NextResponse } from 'next/server';
import { getSession, generateCsrfToken } from '@/lib/auth';

export async function GET() {
  const sessionId = await getSession();
  if (!sessionId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json({ csrf: generateCsrfToken(sessionId) });
}
