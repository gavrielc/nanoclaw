# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to multiple channels (WhatsApp, Telegram, Discord) via a message bus, routes messages to Claude Agent SDK running in Docker containers (or Apple Container on macOS). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: channel setup, message routing, IPC |
| `src/channels/` | Channel abstraction: WhatsApp, Telegram, Discord |
| `src/message-bus.ts` | Decoupled message routing between channels and agents |
| `src/container-runner.ts` | Spawns agent containers (Docker or Apple Container) |
| `src/security.ts` | Security controls, Docker hardening, input validation |
| `src/memory.ts` | Per-group memory (daily + long-term) |
| `src/config.ts` | Trigger pattern, paths, intervals, channel config |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/` | Agent skills (market analysis, software engineer, etc.) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly - don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Docker Compose (Windows 11 / Linux):
```bash
docker compose up -d     # Start services
docker compose logs -f   # View logs
docker compose down      # Stop services
```

Service management (macOS):
```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```
