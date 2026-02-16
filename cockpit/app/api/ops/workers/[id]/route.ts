import { type NextRequest, NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await opsFetch(`/ops/workers/${encodeURIComponent(id)}`);
    return NextResponse.json(data);
  } catch (err) {
    const status = (err as Error & { message?: string })?.message?.includes('404') ? 404 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status },
    );
  }
}
