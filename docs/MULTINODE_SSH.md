# Multi-Node Workers with SSH Tunnels

NanoClaw supports distributing governance task execution across multiple worker nodes. Workers run container agents locally and communicate with the Control Plane (CP) exclusively through SSH tunnels — no public HTTP ports are ever exposed on workers.

## Architecture

```
Control Plane (:7700)                    Worker (127.0.0.1:7801)
├── gov-loop.ts                          ├── worker-service.ts
│   └── dispatchReadyTasks()             │   ├── GET /worker/health
│       ├── selectWorker()               │   ├── POST /worker/dispatch
│       └── POST localhost:{tunnel}/     │   └── runs container-runner
│           worker/dispatch              │
├── worker-tunnels.ts                    ├── worker-ipc-relay.ts
│   └── ssh -NL {local}:127.0.0.1:7801  │   └── watches IPC → POSTs to CP
│       worker@{host}                    │
├── worker-db.ts (workers table)         └── POST {CP_CALLBACK_URL}/
├── ops-http.ts                              ops/worker/{ipc,completion}
│   ├── POST /ops/worker/ipc ← callback
│   └── POST /ops/worker/completion
└── worker-dispatch.ts
```

**Key invariants:**
- Worker binds to `127.0.0.1` only — never publicly accessible
- CP→Worker: SSH local port forwarding (`ssh -NL`)
- Worker→CP: HTTP to CP's reachable URL (or reverse tunnel)
- HMAC+TTL+request_id replay protection on ALL cross-node requests
- No workers configured = pure local dispatch (backward compatible)

## Worker Setup

### 1. Install NanoClaw on the worker

```bash
git clone <repo> && cd nanoclaw && npm install
```

### 2. Configure environment

```bash
export WORKER_MODE=1
export WORKER_PORT=7801
export WORKER_SHARED_SECRET=<generate with: openssl rand -hex 32>
export WORKER_CP_CALLBACK_URL=http://<cp-ip>:7700
```

### 3. Start the worker

```bash
npx tsx src/worker-service.ts
```

The worker listens on `127.0.0.1:7801` — only accessible through SSH.

## Control Plane Setup

### 1. Register worker in database

```bash
sqlite3 store/messages.db "INSERT INTO workers (
  id, ssh_host, ssh_user, ssh_port, local_port, remote_port,
  shared_secret, status, max_wip, current_wip, created_at, updated_at
) VALUES (
  'worker-1', '<worker-ip>', 'deploy', 22, 7810, 7801,
  '<same-shared-secret>', 'online', 2, 0,
  datetime('now'), datetime('now')
);"
```

### 2. Distribute SSH keys

```bash
# On CP: generate ed25519 key (if not exists)
ssh-keygen -t ed25519 -f ~/.ssh/nanoclaw_worker -N ""

# Copy to worker
ssh-copy-id -i ~/.ssh/nanoclaw_worker.pub deploy@<worker-ip>

# Update worker record with identity file
sqlite3 store/messages.db "UPDATE workers SET ssh_identity_file = '/root/.ssh/nanoclaw_worker' WHERE id = 'worker-1';"
```

### 3. Start tunnel (manual or via systemd)

```bash
ssh -NL 7810:127.0.0.1:7801 -i ~/.ssh/nanoclaw_worker deploy@<worker-ip> \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o BatchMode=yes
```

Or use the included systemd template:
```bash
sudo cp docs/nanoclaw-worker-tunnel@.service /etc/systemd/system/
sudo systemctl enable --now nanoclaw-worker-tunnel@7810:deploy@worker-ip
```

## SSH Hardening

### sshd_config checklist

On each worker node, create `/etc/ssh/sshd_config.d/nanoclaw.conf`:

```bash
# /etc/ssh/sshd_config.d/nanoclaw.conf

# Only allow the deploy user
AllowUsers deploy

# Key-based auth only — no passwords
PasswordAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes

# Only ed25519 keys (strongest, fastest)
HostKeyAlgorithms ssh-ed25519
PubkeyAcceptedAlgorithms ssh-ed25519

# Restrict forwarding to local only (no remote/dynamic)
AllowTcpForwarding local
GatewayPorts no
X11Forwarding no
PermitTunnel no
AllowAgentForwarding no
AllowStreamLocalForwarding no

# Session limits
MaxAuthTries 3
MaxSessions 5
LoginGraceTime 30
ClientAliveInterval 60
ClientAliveCountMax 3

# Logging
LogLevel VERBOSE
```

After editing, reload sshd:
```bash
sudo sshd -t && sudo systemctl reload sshd
```

### Systemd tunnel template

The included `nanoclaw-worker-tunnel@.service` template has these hardened defaults:
- `Restart=always` — tunnel always comes back
- `StartLimitIntervalSec=120`, `StartLimitBurst=10` — burst protection (max 10 restarts per 2min)
- `TimeoutStartSec=30` — fail fast if SSH can't connect
- `StrictHostKeyChecking=yes` — reject unknown hosts
- `ProtectSystem=strict`, `PrivateTmp=yes`, `ProtectHome=read-only` — systemd sandboxing

## Firewall

On worker:
```bash
ufw default deny incoming
ufw allow from <CP_IP> to any port 22
ufw enable
```

## HMAC+TTL+Replay Protocol

Every cross-node request includes:

| Header | Value |
|--------|-------|
| `X-Worker-HMAC` | HMAC-SHA256(secret, timestamp + "\n" + requestId + "\n" + body) |
| `X-Worker-Timestamp` | ISO 8601 |
| `X-Worker-RequestId` | UUIDv4 |
| `X-Worker-Id` | worker id (on callbacks) |

Verification:
1. Missing headers → 401
2. TTL: `|now - timestamp| > NONCE_TTL_MS` (default 60s) → 401 TTL_EXPIRED
3. Replay: `request_id` seen before → 401 REPLAY_DETECTED
4. HMAC: `crypto.timingSafeEqual()` → 401 HMAC_INVALID
5. Record nonce (cleaned up at startup + every 6h, capped at 100k rows)

## Dev Mode (localhost)

```bash
# Terminal 1: CP
OS_HTTP_SECRET=dev-secret npm run dev

# Terminal 2: Worker
WORKER_MODE=1 WORKER_PORT=7801 \
  WORKER_SHARED_SECRET=test-hmac-secret \
  WORKER_CP_CALLBACK_URL=http://localhost:7700 \
  npx tsx src/worker-service.ts

# Terminal 3: SSH tunnel (localhost to localhost)
ssh -NL 7810:127.0.0.1:7801 $(whoami)@localhost

# Register worker
sqlite3 store/messages.db "INSERT INTO workers (
  id, ssh_host, ssh_user, local_port, remote_port, shared_secret,
  status, max_wip, current_wip, created_at, updated_at
) VALUES (
  'worker-1', 'localhost', '$(whoami)', 7810, 7801,
  'test-hmac-secret', 'online', 2, 0,
  datetime('now'), datetime('now')
);"
```

## Monitoring

### Worker health (through tunnel)
```bash
curl http://localhost:7810/worker/health
# → { "status": "ok", "uptime_seconds": 42, "active_tasks": 0 }
```

### Dispatch history
```bash
sqlite3 store/messages.db "SELECT dispatch_key, worker_id, status FROM gov_dispatches ORDER BY created_at DESC LIMIT 10;"
```

### Worker status
```bash
sqlite3 store/messages.db "SELECT id, status, current_wip, max_wip FROM workers;"
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `DISPATCH_DEFERRED_TUNNEL_DOWN` in activities | SSH tunnel not connected | Check `ssh` process, verify SSH keys |
| `TTL_EXPIRED` on callbacks | Clock skew > NONCE_TTL_MS | Sync NTP on both nodes |
| `DISPATCH_DEFERRED_NO_WORKER` in activities | No worker serves this group | Add group to worker's `groups_json` column |
| `HMAC_INVALID` | Mismatched shared secret | Verify `WORKER_SHARED_SECRET` matches CP `shared_secret` column |
| `REPLAY_DETECTED` | Duplicate request (crash recovery) | Safe to ignore — idempotent |
| Worker stays offline | Health check failing 3x | Check worker process is running, verify tunnel forwarding |

## Environment Variables

| Variable | Default | Where | Purpose |
|----------|---------|-------|---------|
| `WORKER_PORT` | `7801` | Worker | HTTP listen port (127.0.0.1) |
| `WORKER_MODE` | (unset) | Worker | Set `1` to start in worker mode |
| `WORKER_SHARED_SECRET` | (required) | Worker | HMAC shared secret |
| `WORKER_CP_CALLBACK_URL` | (required) | Worker | CP URL for callbacks |
| `WORKER_HEALTH_INTERVAL` | `30000` | CP | Health check interval (ms) |
| `WORKER_TUNNEL_RECONNECT_MAX` | `10` | CP | Max reconnect attempts |
| `NONCE_TTL_MS` | `60000` | Both | HMAC request TTL (ms) |
| `NONCE_CLEANUP_OLDER_THAN_MS` | `86400000` | Both | Delete nonces older than (ms) |
| `NONCE_CAP` | `100000` | Both | Max nonces in table |
| `NONCE_CLEANUP_INTERVAL_MS` | `21600000` | Both | Periodic cleanup interval (ms, 6h) |
