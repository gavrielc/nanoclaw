# NanoClaw Cockpit

Read-only dashboard for NanoClaw OS. Provides visibility into governance tasks, products, memory, and system health.

## Architecture

```
Browser --> Cockpit (Next.js :3000)
              |
              +--> /api/ops/* (server-side proxy, injects X-OS-SECRET)
              |
              +--> Host ops-http (:7700)
```

All API calls go through Next.js server-side routes. The `OS_HTTP_SECRET` is never sent to the browser.

## Setup

```bash
cd cockpit
npm install
cp .env.example .env.local
# Edit .env.local with your values
npm run dev
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OS_HOST_URL` | `http://localhost:7700` | Host ops-http server URL |
| `OS_HTTP_SECRET` | _(required)_ | Shared secret for `X-OS-SECRET` header |

## Pages

| Path | Description |
|------|-------------|
| `/` | Dashboard — task counts, WIP load, ext calls, failed dispatches |
| `/tasks` | Task list with state/type filters |
| `/tasks/[id]` | Task detail + activity timeline |
| `/products` | Product cards |
| `/products/[id]` | Product detail + associated tasks |
| `/memory` | Keyword search across memories |
| `/health` | System health check |

## Host Setup

The host must have `OS_HTTP_SECRET` set and ops-http running (automatic when NanoClaw starts):

```bash
export OS_HTTP_SECRET=your-secret-here
npm run dev  # starts host + ops-http on :7700
```

## Limitations

- Read-only — no write operations
- No real-time updates — pages use ISR (5s revalidation)
- No authentication on cockpit UI — relies on network isolation
- Memory search is keyword-only (no semantic search)
