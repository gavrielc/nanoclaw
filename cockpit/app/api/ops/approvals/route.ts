import { NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET() {
  try {
    const data = await opsFetch('/ops/approvals');
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
