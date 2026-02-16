import { NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET() {
  try {
    const data = await opsFetch('/ops/workers');
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    );
  }
}
