# Cockpit Security Model

> Threat model and security controls for the NanoClaw Cockpit UI.

---

## Architecture

```
Browser (untrusted)
  |
  v
Cockpit (Next.js, server-side) -- trusted boundary
  |
  +-- OS_HTTP_SECRET injected here (env var, never in client bundle)
  |
  v
Host ops-http (:7700) -- X-OS-SECRET header validated
  |
  v
SQLite (read-only queries)
```

## Secret Handling

| Secret | Location | Exposure |
|--------|----------|----------|
| `OS_HTTP_SECRET` | Host `process.env` + Cockpit `.env.local` | Server-side only. Never in client JS bundle. |
| Database path | Host `process.env.STORE_DIR` | Not exposed to Cockpit. |
| API keys (GitHub, embedding) | Host `process.env` | Not exposed to Cockpit. |

**Invariant:** The browser never sees `OS_HTTP_SECRET`. All API calls go through Next.js server-side route handlers that inject the secret.

## Fail-Closed Design

1. **No secret configured on host** (`OS_HTTP_SECRET=""`) → all requests return 401. No data leaks.
2. **Wrong secret** → 401. No partial data.
3. **Missing `X-OS-SECRET` header** → 401.
4. **Unknown routes** → 404.
5. **Non-GET methods** → 405. No write operations possible.

## Read-Only Guarantee

- Host `src/ops-http.ts` only exposes GET endpoints.
- No POST, PUT, PATCH, DELETE handlers exist.
- All data comes from `SELECT` queries — no `INSERT`, `UPDATE`, or `DELETE`.
- Cockpit API routes only call `opsFetch()` which only makes GET requests.

## Data Sensitivity

| Data Type | Visible in Cockpit | Notes |
|-----------|--------------------|-------|
| Task metadata | Yes | Title, state, priority, assignments |
| Task descriptions | Yes | May contain business context |
| Activity logs | Yes | State transitions, actors |
| Product info | Yes | Name, status, risk level |
| Memory content (L0-L2) | Yes (via search) | Sanitized — PII already removed by `pii-guard.ts` |
| Memory content (L3) | No | `searchMemoriesByKeywords()` respects level filter; L3 excluded unless explicitly requested |
| PII (raw) | Never | PII is sanitized before storage — never persisted in `memories` table |
| Secrets/tokens | Never | Not stored in any queryable table |

## CORS

Host ops-http sets `Access-Control-Allow-Origin: *` because:
- All endpoints are read-only (no state-changing operations)
- Authentication via `X-OS-SECRET` header (not cookies)
- No CSRF risk since there are no mutations

## Threats and Mitigations

| Threat | Mitigation |
|--------|------------|
| Secret in client bundle | Secret only in `.env.local`, injected server-side in API routes |
| Brute-force secret | Rate limiting at network level (firewall/reverse proxy) |
| SSRF via proxy | `opsFetch()` only calls configured `OS_HOST_URL` — no user-controlled URLs |
| XSS in memory content | React auto-escapes all rendered content; no `dangerouslySetInnerHTML` |
| Unauthorized access to cockpit | Network isolation (localhost/VPN). No built-in auth on cockpit UI. |
| L3 memory exposure | `searchMemoriesByKeywords()` filters by `maxLevel`; cockpit doesn't pass L3 |

## Recommendations

1. Run cockpit behind a reverse proxy (nginx/Caddy) with TLS
2. Restrict cockpit access to VPN or localhost
3. Set a strong `OS_HTTP_SECRET` (32+ random characters)
4. Monitor host logs for 401 responses (potential brute-force attempts)
5. Consider adding basic auth to cockpit in production if exposed to network
