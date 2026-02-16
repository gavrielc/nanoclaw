import { type NextRequest, NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await opsFetch(
      `/ops/workers/${encodeURIComponent(id)}/tunnels`,
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    );
  }
}
