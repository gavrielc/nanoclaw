import { type NextRequest, NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET(request: NextRequest) {
  try {
    const params: Record<string, string> = {};
    const sp = request.nextUrl.searchParams;
    for (const key of ['q', 'level', 'limit']) {
      const val = sp.get(key);
      if (val) params[key] = val;
    }
    const data = await opsFetch('/ops/memories', params);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const status = msg.includes('501') ? 501 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
