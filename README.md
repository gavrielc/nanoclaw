<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  Personal Claude assistant that runs securely in Docker containers. Multi-channel, multi-skill, built for Windows 11 and Linux.
</p>

## Why NanoClaw

NanoClaw gives you a personal AI assistant with real isolation. Agents run in Docker containers with no network access, dropped capabilities, and read-only filesystems. The codebase is small enough to understand in 8 minutes.

Inspired by [nanobot](https://github.com/wangsc2024/nanobot)'s architecture - decoupled channels, message bus routing, and pluggable skills - but keeping NanoClaw's container-first security model.

## Quick Start

### Windows 11 (Docker Desktop)

```bash
# Prerequisites: Docker Desktop for Windows, Node.js 20+
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
cp .env.example .env
# Edit .env with your API keys

# Option 1: Run with Docker Compose
docker compose up -d

# Option 2: Run directly
npm install
npm run build
./container/build.sh  # Build agent container
npm start
```

### Linux

```bash
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
cp .env.example .env
# Edit .env with your API keys

npm install
npm run build
./container/build.sh
npm start
```

### macOS

```bash
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
claude  # Then run /setup
```

## Architecture

```
Chat Apps --> Message Bus --> Agent Router --> Docker Container --> Response
(WhatsApp)    (decoupled)    (queue/IPC)      (Claude Agent SDK)
(Telegram)
(Discord)
```

Single Node.js process. Agents execute in isolated Docker containers with mounted directories. IPC via filesystem. No daemons, no queues, no complexity.

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: channel setup, message routing, IPC |
| `src/channels/` | Channel abstraction: WhatsApp, Telegram, Discord |
| `src/message-bus.ts` | Decoupled message routing between channels and agents |
| `src/container-runner.ts` | Spawns agent containers (Docker or Apple Container) |
| `src/security.ts` | Security controls, input validation, Docker hardening |
| `src/memory.ts` | Per-group memory management (daily + long-term) |
| `src/task-scheduler.ts` | Scheduled task execution |
| `src/db.ts` | SQLite operations |
| `container/skills/` | Agent skill definitions |

## Channels

### WhatsApp (Primary)
Built-in via Baileys. Authenticate with QR code during setup.

### Telegram (Optional)
Set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN` in `.env`.

### Discord (Optional)
Set `DISCORD_ENABLED=true` and `DISCORD_BOT_TOKEN` in `.env`.

## Agent Skills

Built-in skills available to all agents:

| Skill | Description |
|-------|-------------|
| **Market Analysis** | 24/7 financial market monitoring, technical analysis, news sentiment |
| **Software Engineer** | Full-stack development, code review, debugging, architecture |
| **Daily Routine** | Morning briefings, task management, habit tracking, weekly planning |
| **Knowledge Assistant** | Information capture, research, summarization, knowledge retrieval |
| **Browser Automation** | Web navigation and data extraction |

Skills are markdown files in `container/skills/` that teach agents specialized behaviors.

## Security

Defense-in-depth approach:

- **Container Isolation**: Agents run in Docker with `--network=none`, `--cap-drop=ALL`, `--read-only`
- **Resource Limits**: Memory (1GB), CPU (1 core), PIDs (256) per container
- **Mount Security**: External allowlist prevents access to sensitive directories
- **Input Validation**: XML escaping, URL validation, secret detection
- **Shell Guards**: Dangerous command patterns blocked (rm -rf, fork bombs, etc.)
- **Rate Limiting**: Per-sender rate limits on external channels
- **Secret Filtering**: Only explicitly allowed env vars passed to containers
- **Non-root Execution**: Container processes run as `node` user

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

## Configuration

All configuration via environment variables (`.env` file):

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Channels
WHATSAPP_ENABLED=true
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
DISCORD_ENABLED=false
DISCORD_BOT_TOKEN=

# Container
CONTAINER_RUNTIME=docker    # or apple-container
CONTAINER_TIMEOUT=300000
MAX_CONCURRENT_CONTAINERS=5

# See .env.example for all options
```

## Docker Compose

For production deployment on Windows 11 or Linux:

```bash
docker compose up -d          # Start
docker compose logs -f app    # View logs
docker compose down           # Stop
```

The compose file handles:
- Docker socket mounting for agent container orchestration
- Persistent volumes for data, groups, and authentication
- Health checks and resource limits
- Network isolation

## Development

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm run typecheck    # Type check without emitting
./container/build.sh # Rebuild agent container
```

## Requirements

- Node.js 20+
- Docker Desktop (Windows 11) or Docker Engine (Linux) or Apple Container (macOS)
- [Claude Code](https://claude.ai/download) (for interactive setup)

## License

MIT
