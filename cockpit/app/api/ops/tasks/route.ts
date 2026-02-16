import { type NextRequest, NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET(request: NextRequest) {
  try {
    const params: Record<string, string> = {};
    const sp = request.nextUrl.searchParams;
    for (const key of ['state', 'type', 'product_id', 'limit']) {
      const val = sp.get(key);
      if (val) params[key] = val;
    }
    const data = await opsFetch('/ops/tasks', params);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    );
  }
}
