# Cockpit SSE — Real-Time Events

Sprint 10 adds Server-Sent Events (SSE) and a workers panel to the cockpit dashboard.

## Architecture

```
Browser (EventSource)          Cockpit (Next.js)            Host (ops-http)
  │                               │                            │
  │ GET /api/ops/events           │                            │
  ├──────────────────────────────>│ GET /ops/events             │
  │                               │  + X-OS-SECRET header      │
  │                               ├───────────────────────────>│
  │                               │                            │ Auth check
  │                               │ text/event-stream          │
  │                               │<───────────────────────────│
  │ text/event-stream (proxied)   │                            │
  │<──────────────────────────────│                            │
  │                               │                            │
  │ event: worker:status          │ (passthrough)              │ emitOpsEvent()
  │<────────────────────────────────────────────────────────────│
```

**Security model**: Browser never sees `X-OS-SECRET`. The cockpit Next.js server-side proxy injects the header. Browser sessions are authenticated via httpOnly session cookie (Sprint 8).

## Event Types

| Event | Source | Payload |
|-------|--------|---------|
| `worker:status` | worker-tunnels.ts | `{ workerId, status }` |
| `tunnel:status` | worker-tunnels.ts | `{ workerId, status, reason? }` |
| `dispatch:lifecycle` | gov-loop.ts | `{ taskId, workerId, status, reason? }` |
| `limits:denial` | limits/enforce.ts | `{ op, scopeKey, code, provider?, group? }` |
| `breaker:state` | limits/enforce.ts | `{ provider, state, group? }` |

## Worker Read Endpoints

| Endpoint | Auth | Returns |
|----------|------|---------|
| `GET /ops/workers` | X-OS-SECRET | Worker list (sanitized) |
| `GET /ops/workers/:id` | X-OS-SECRET | Single worker (sanitized) |
| `GET /ops/workers/:id/dispatches?limit=20` | X-OS-SECRET | Recent dispatches |
| `GET /ops/workers/:id/tunnels` | X-OS-SECRET | Tunnel status |

**Sanitization**: `shared_secret` and `ssh_identity_file` are stripped from all worker responses. SSE events are sanitized via `FORBIDDEN_KEYS` set (tokens, passwords, HMAC secrets, env vars).

## Threat Model

### Data in browser

- Worker IDs, hostnames, ports, status, WIP counts, group assignments
- Dispatch IDs, task IDs, timestamps, status
- Tunnel up/down status
- Rate limit denial metadata (operation type, scope key)

### Data never in browser

- `shared_secret` (HMAC keys)
- `ssh_identity_file` (SSH key paths)
- `token`, `password`, `hmac`, `secret` (any field matching forbidden keys)
- `OS_HTTP_SECRET`, `GITHUB_TOKEN`, `COCKPIT_*` secrets
- Raw IPC params, ext_call params

### Attack surface

| Vector | Mitigation |
|--------|------------|
| Unauthenticated SSE | `X-OS-SECRET` required on host; session cookie on cockpit proxy |
| SSE connection flood | Max 3 per source IP (429 on excess) |
| Long-lived idle connections | 15-minute idle timeout with 1-minute cleanup |
| Secret leakage in events | `FORBIDDEN_KEYS` sanitization on every `emitOpsEvent()` call |
| String overflow in events | Strings >500 chars truncated |
| Nested secret leakage | Recursive sanitization on nested objects |

## Connection Limits

| Parameter | Value |
|-----------|-------|
| Max connections per source IP | 3 |
| Idle timeout | 15 minutes |
| Heartbeat interval | 30 seconds |
| Idle check interval | 1 minute |

## Client-Side Hook

`cockpit/lib/use-sse.ts` provides `useSse(onEvent)`:

- Connects to `/api/ops/events` via `EventSource`
- Exponential backoff on disconnect (1s, 2s, 4s, max 30s)
- Deduplicates events by ID (monotonic counter)
- Returns `{ connected: boolean }`

## Backward Compatibility

- If no SSE clients connect, `emitOpsEvent()` is a no-op (early return on empty connections map)
- Workers pages work without SSE — initial data loaded via `fetch()` on page load
- SSE adds real-time updates on top of the initial fetch

## Operational Notes

### Monitoring

```bash
# Check active SSE connections
curl -H "X-OS-SECRET: $SECRET" http://localhost:7700/ops/stats

# List workers
curl -H "X-OS-SECRET: $SECRET" http://localhost:7700/ops/workers

# Worker dispatches
curl -H "X-OS-SECRET: $SECRET" http://localhost:7700/ops/workers/worker-1/dispatches
```

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| SSE returns 401 | Missing/wrong `X-OS-SECRET` | Check `OS_HTTP_SECRET` env var |
| SSE returns 429 | >3 connections from same IP | Close stale browser tabs |
| Events not appearing | No `emitOpsEvent()` calls firing | Check worker-tunnels/gov-loop are running |
| Stale data in cockpit | SSE disconnected, no reconnect | Check browser console for EventSource errors |

## Files

| File | Purpose |
|------|---------|
| `src/ops-events.ts` | EventBus, sanitization, SSE connection manager |
| `src/ops-http.ts` | Worker read routes + SSE route |
| `cockpit/app/api/ops/events/route.ts` | SSE proxy (injects X-OS-SECRET) |
| `cockpit/app/api/ops/workers/route.ts` | Workers list proxy |
| `cockpit/app/api/ops/workers/[id]/route.ts` | Worker detail proxy |
| `cockpit/app/api/ops/workers/[id]/dispatches/route.ts` | Dispatches proxy |
| `cockpit/app/api/ops/workers/[id]/tunnels/route.ts` | Tunnels proxy |
| `cockpit/lib/use-sse.ts` | Client SSE hook with backoff + dedupe |
| `cockpit/app/workers/page.tsx` | Workers list page |
| `cockpit/app/workers/[id]/page.tsx` | Worker detail page |
| `src/sprint10.test.ts` | 13 tests (SSE, sanitization, workers, limits) |
