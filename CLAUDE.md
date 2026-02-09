# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running directly in-process. Responds to any chat where the trigger pattern (`@Andy`) is detected.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: WhatsApp connection, message routing, IPC |
| `src/agent.ts` | Claude Agent SDK wrapper (direct invocation) |
| `src/mcp-server.ts` | MCP tools: send_message, schedule_task, etc. |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
```

Service management:
```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```
