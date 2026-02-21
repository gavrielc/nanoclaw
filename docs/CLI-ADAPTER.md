# CLI Agent Adapter

NanoClaw can run LLM conversations through a local CLI adapter instead of the SDK token path.

Supported CLI backends:

- `AGENT_BACKEND=codex`
- `AGENT_BACKEND=cursor-agent`

## Required .env settings

```bash
AGENT_BACKEND=codex
```

or:

```bash
AGENT_BACKEND=cursor-agent
```

## How it works

1. NanoClaw receives incoming messages from the configured channel.
2. The container agent-runner selects the CLI adapter.
3. Adapter executes one of:

```bash
codex exec -C /workspace/group --dangerously-bypass-approvals-and-sandbox --json -
```

```bash
cursor-agent -p --trust --workspace /workspace/group --output-format text "<prompt>"
```

4. Prompt/response is parsed and returned through NanoClaw's output protocol.

## Capability differences vs SDK backend

With CLI backends (`codex` or `cursor-agent`):

- No MCP tool integration (`send_message`, task tools, etc.)
- No Agent Teams orchestration
- No SDK session resume semantics
- Conversational CLI execution only

## Optional overrides

- `AGENT_CLI_CMD`: override executable path/name
- `AGENT_CLI_ARGS`: JSON array of extra args (optional, applied to Codex preset)
- `AGENT_CLI_OUTPUT_FORMAT`: `text` (default) or `json` for Cursor preset
- `CONTAINER_TIMEOUT`: timeout in ms (default `1800000`)

## Runtime notes

- Container image installs Codex CLI by default.
- Cursor CLI binary must be available in runtime PATH (or configured via `AGENT_CLI_CMD`).

## Troubleshooting

- `AGENT_BACKEND must be "codex" or "cursor-agent"`: set one of those in `.env`
- `CLI exited with code ...`: verify selected CLI binary is installed and runnable
- No responses: check `logs/nanoclaw.error.log` and group container logs under `groups/main/logs/`
