# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in Apple Container (Linux VMs). Each group has isolated filesystem and memory. Container agents have access to Home Assistant via ha-mcp for smart home control and TTS announcements.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: WhatsApp connection, message routing, IPC |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts, captures HA actions |
| `src/api.ts` | HTTP API for voice plugin and external integrations |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser/` | Browser automation tool |
| `container/skills/home-assistant/` | Home Assistant device control via ha-mcp |
| `container/skills/announcements/` | TTS announcements via ha-mcp |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Voice Integration Architecture

Three services run on the host, each managed by launchd:

```
NanoClaw (Node.js)          ha-mcp-web (:8086)          Voice Plugin (Python, :10300)
  WhatsApp channel            HA MCP sidecar               ESP32 WebSocket
  HTTP API (:3100)            97 tools: search,            STT/TTS
  Container spawning          control, state, TTS          Fast path (learned actions)
  Task scheduling             Fuzzy entity search          Learning store
```

**ha-mcp** is the centralized Home Assistant layer. All HA access goes through it — container agents via MCP, voice plugin fast path via HTTP. Single HA token, single process.

**Voice plugin** is a fast audio I/O layer with a learnable cache. All reasoning goes to NanoClaw via the HTTP API.

### Two-Path Voice Resolution

| Path | Latency | Handler |
|------|---------|---------|
| Fast path | ~200ms | Voice plugin matches learned phrase, calls ha-mcp directly |
| NanoClaw path | ~5-15s | Voice plugin POSTs to HTTP API, container agent reasons with ha-mcp |

### ha-mcp Tools in Containers

Container agents get HA tools automatically via MCP:
- `mcp__home-assistant__ha_search_entities` — Fuzzy entity search (typo-tolerant)
- `mcp__home-assistant__ha_call_service` — Control devices, TTS, automations
- `mcp__home-assistant__ha_get_state` — Read sensor values and device state

Action capture: When agents call `ha_call_service`, the agent-runner's PostToolUse hook captures the call. NanoClaw includes captured actions in the API response for the voice plugin's learning store.

### HTTP API

`POST /api/message` — Submit a message and receive a structured response:

```json
Request:  { "text": "dim the bedroom lights", "channel": "voice", "context": { "room": "bedroom" } }
Response: { "text": "Dimmed the bedroom lights", "actions": [{ "entity_id": "light.bedroom", "domain": "light", "service": "turn_on", "data": { "brightness": 76 } }] }
```

- Port: 3100 (configurable via `NANOCLAW_API_PORT`)
- Auth: `Bearer <NANOCLAW_API_TOKEN>` (token in `~/.nanoclaw/env`)
- Async mode: Add `"async": true` for fire-and-forget (returns `202 Accepted`)

`GET /api/health` — Health check (no auth required)

### TTS Announcements

Container agents can make spoken announcements via ha-mcp's TTS tools. This works from any channel:
- Scheduled tasks (e.g., morning briefing, reminders)
- WhatsApp messages ("announce dinner is ready")
- Voice requests routed through the HTTP API

See `container/skills/announcements/` for the full skill reference.

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# NanoClaw main process
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# ha-mcp sidecar (Home Assistant MCP server on port 8086)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.ha-mcp.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.ha-mcp.plist
```

ha-mcp setup and health check:
```bash
./scripts/ha-mcp-setup.sh    # Verify install, env vars, connectivity
```

ha-mcp requires `HA_URL` and `HA_TOKEN` in `~/.nanoclaw/env`. See `config-examples/env.example`.

## Container Build Cache

Apple Container's buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild:

```bash
container builder stop && container builder rm && container builder start
./container/build.sh
```

Always verify after rebuild: `container run -i --rm --entrypoint wc nanoclaw-agent:latest -l /app/src/index.ts`
