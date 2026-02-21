# NanoClaw Manual Setup (CLI Backends)

This guide sets up NanoClaw with:

- your existing NanoClaw chat channel setup
- Codex CLI or Cursor Agent CLI as the LLM backend
- No API-token-based SDK flow

## Prerequisites

- Node.js 20+
- Docker running
- CLI binary for the backend you choose:
  - `codex` for `AGENT_BACKEND=codex` (installed in the container image by default)
  - `cursor-agent` for `AGENT_BACKEND=cursor-agent` (must be available in runtime PATH or configured via `AGENT_CLI_CMD`)

## Step 1: Install dependencies

```bash
npm install
```

## Step 2: Build the container image

```bash
./.claude/skills/setup/scripts/03-setup-container.sh --runtime docker
```

## Step 3: Configure `.env`

Create `.env` in project root:

```bash
AGENT_BACKEND=codex
```

Notes:

- Set `AGENT_BACKEND=cursor-agent` to use Cursor instead.
- Optional Codex local-model mode: `AGENT_CLI_ARGS=["--oss","--local-provider=ollama"]`
- Optional Cursor JSON output: `AGENT_CLI_OUTPUT_FORMAT=json`
- Optional CLI path override: `AGENT_CLI_CMD=/path/to/your/cli`

## Step 4: Start NanoClaw

```bash
npm run build
npm start
```

Or use the service script:

```bash
./.claude/skills/setup/scripts/08-setup-service.sh
```

## Step 5: Verify conversation

Send:

```text
@Andy hello
```

(or your configured assistant name)

Then check logs if needed:

```bash
tail -f logs/nanoclaw.log
tail -f logs/nanoclaw.error.log
```

## Troubleshooting

- `AGENT_BACKEND must be "codex" or "cursor-agent"`: set one of these values in `.env`
- `CLI exited with code ...`: ensure the selected CLI binary is installed and runnable
- CLI failures: inspect latest `groups/main/logs/container-*.log`
