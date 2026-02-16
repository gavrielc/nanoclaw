/**
 * SSE proxy — streams events from host /ops/events to cockpit browser.
 * Auth: cockpit session cookie (validated by middleware).
 * The upstream connection uses X-OS-SECRET (never exposed to browser).
 */

const HOST_URL = process.env.OS_HOST_URL || 'http://localhost:7700';
const SECRET = process.env.OS_HTTP_SECRET || '';

export async function GET() {
  const upstreamUrl = new URL('/ops/events', HOST_URL);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl.toString(), {
      headers: { 'X-OS-SECRET': SECRET },
      cache: 'no-store',
    });
  } catch {
    return new Response(JSON.stringify({ error: 'SSE upstream unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstreamRes.ok || !upstreamRes.body) {
    return new Response(
      JSON.stringify({ error: `SSE upstream ${upstreamRes.status}` }),
      { status: upstreamRes.status, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Stream the SSE body through to the browser
  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
