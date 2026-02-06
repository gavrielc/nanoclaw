# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp and Telegram, routes messages to Claude Agent SDK running in Docker containers. Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: message routing, IPC, channel orchestration |
| `src/telegram-channel.ts` | Telegram bot via Grammy (long polling) |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly—don't tell the user to run them.

```bash
pnpm run dev          # Run with hot reload
pnpm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
systemctl --user start nanoclaw    # Start
systemctl --user stop nanoclaw     # Stop
systemctl --user restart nanoclaw  # Restart
systemctl --user status nanoclaw   # Status
journalctl --user -u nanoclaw -f   # Follow logs
```
