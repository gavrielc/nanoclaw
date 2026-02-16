import { NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await opsFetch(`/ops/products/${encodeURIComponent(id)}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    );
  }
}
