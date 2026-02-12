# IT Admin Automation Design

**Date:** 2026-02-13
**Status:** Approved

## Overview

Add an IT admin WhatsApp group integration that allows IT team members to request code changes via WhatsApp. The bot receives requests, gathers specs through conversational interview, spawns a Claude Code CLI subprocess to implement changes, and notifies the team with a full summary.

## Requirements

| Aspect | Decision |
|--------|----------|
| Group config | `it_admin_group_name` + `it_admin_phones[]` in tenant.yaml |
| Trigger | `@CodeBot` prefix in IT WhatsApp group |
| Spec flow | Conversational interview (2-4 questions, Agent SDK Sonnet) |
| Architect/Review | Uses existing Claude Code skill plugins natively |
| Execution | Spawn `claude` CLI as child process with full filesystem + git access |
| Git strategy | New branch per request (`it/<slug>`), no auto-merge |
| Restart | Self-restart via `launchctl unload + load` |
| Notification | Full summary: branch, files changed, test results, tokens, description |
| Concurrency | One task at a time, queue + notify if busy (max 3 queued) |
| Rate limiting | IT group members exempt from message limits |
| IT identity | Phone allowlist from tenant.yaml (no DB role changes) |

## Architecture

### Approach: Stateful IT Handler with Claude CLI Subprocess

A new `ITAdminService` class manages the lifecycle of IT code requests. It uses a state machine to track progress and coordinates between an interview agent (Agent SDK) and a coding agent (Claude CLI subprocess).

### State Machine

```
idle -> gathering_specs -> coding -> reviewing -> pushing -> restarting -> notifying -> idle
```

| State | Trigger | Action |
|-------|---------|--------|
| `idle` | `@CodeBot <request>` | Start interview agent, move to `gathering_specs` |
| `gathering_specs` | User replies in group | Forward to interview agent. When specs complete -> `coding` |
| `coding` | Auto | Spawn `claude` CLI on new branch. Stream progress to group |
| `reviewing` | Auto | Claude CLI uses code-review skill internally |
| `pushing` | Auto | `git push`, post summary to group |
| `restarting` | Auto | `launchctl unload + load`, write pending notification file |
| `notifying` | On startup | Read pending file, send final notification, delete file |

### Configuration (tenant.yaml)

```yaml
# IT Admin group
it_admin_group_name: "Daund IT Team"
it_admin_phones:
  - "918282830830"
```

### Routing (index.ts)

- Auto-discover `it_admin_group_jid` by name (same pattern as admin group)
- Register as group with `requiresTrigger: true`
- In `handleInboundMessage()`, add branch before admin group check:
  - If `chatJid === it_admin_group_jid` -> route to `ITAdminService.handleMessage()`
  - Detect `@CodeBot` trigger using configurable pattern
- IT group members identified by `it_admin_phones[]` from config (no DB role needed)
- IT members bypass rate limiting

## Interview Agent (Spec Gathering)

### Design
- Agent SDK `query()` with Sonnet model (fast, cheap)
- No filesystem tools -- pure conversation
- System prompt: analyze request, ask 2-4 clarifying questions, output structured spec
- Uses `resume` for session continuity across WhatsApp messages
- 30-minute timeout: auto-cancel if requester stops replying

### Conversation Flow
```
IT member: @CodeBot Add a /health endpoint that returns uptime
Bot: New IT request received. Let me clarify a few things.
Bot: What HTTP method should /health use? GET or POST?
IT member: GET
Bot: Should it include memory usage and DB connection status, or just uptime?
IT member: All of them
Bot: Spec finalized:
     - GET /health endpoint
     - Returns: uptime, memory usage, DB status
     - Response format: JSON
     Starting implementation...
```

### Spec Output Format
```json
{
  "title": "Add /health endpoint",
  "description": "GET endpoint returning server health metrics",
  "requirements": ["uptime", "memory usage", "DB connection status"],
  "acceptance_criteria": ["Returns JSON", "200 on healthy", "503 on unhealthy"],
  "branch_name": "it/add-health-endpoint"
}
```

## Coding Agent (Claude CLI Subprocess)

### Invocation
```bash
claude --output-format stream-json \
  --model claude-opus-4-6 \
  --allowedTools 'Bash,Read,Write,Edit,Glob,Grep,Task' \
  --permission-mode acceptEdits \
  -p "<full spec prompt>"
```

### Prompt Structure
```
You are implementing a code change for the constituency bot project.

## Spec
<structured spec from interview phase>

## Instructions
1. Create a new git branch: `it/<branch-name>`
2. Explore the codebase to understand existing patterns
3. Implement the changes following existing code style
4. Write tests (TDD approach)
5. Run `npm test` and `npm run typecheck` -- fix any failures
6. Run `npm run format`
7. Commit changes with a descriptive message
8. Push the branch to origin

## Project context
- TypeScript, Node.js, vitest
- Tests colocated: foo.test.ts next to foo.ts
- Working directory: /Users/riyaz/rahulkulproject
```

### Progress Streaming
- Parse stream-json output for status updates
- Throttle WhatsApp updates to every 30 seconds
- Example: "Exploring codebase...", "Writing implementation...", "Running tests..."

### Error Handling
- Non-zero exit code: post error summary, clean up branch
- 30-minute timeout for entire coding phase
- Process crash: state machine resets to `idle`

## Restart Flow

Since `launchctl unload` kills the current process:

1. Before restart, write `data/pending-it-notification.json`:
   ```json
   {
     "groupJid": "<it-group-jid>",
     "notification": "<full summary text>",
     "timestamp": "<ISO timestamp>"
   }
   ```
2. Execute: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist && sleep 2 && launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist`
3. On startup in `main()`, check for pending notification file
4. If found, send notification to IT group and delete file

## Final Notification Format

```
IT Task Complete

Title: Add /health endpoint
Branch: it/add-health-endpoint
Files changed:
  - src/health.ts (new)
  - src/health.test.ts (new)
  - src/index.ts (modified)

Tests: 661 passing, 0 failing
TypeCheck: Clean

LLM Usage:
  - Input tokens: 45,230
  - Output tokens: 12,450
  - Model: claude-opus-4-6

Server restart: Scheduled
```

## New Files

| File | Purpose |
|------|---------|
| `src/it-admin-handler.ts` | Main IT admin service (state machine, message routing) |
| `src/it-admin-handler.test.ts` | Tests |
| `src/it-interview-agent.ts` | Interview/spec-gathering agent (Agent SDK) |
| `src/it-interview-agent.test.ts` | Tests |
| `src/it-code-runner.ts` | Claude CLI subprocess management |
| `src/it-code-runner.test.ts` | Tests |

## Modified Files

| File | Changes |
|------|---------|
| `src/index.ts` | IT group routing, auto-discovery, pending notification check |
| `src/config.ts` | IT-related config constants |
| `src/tenant-config.ts` | `it_admin_group_name`, `it_admin_phones` type fields |
| `config/tenant.yaml` | IT admin config section |
| `CLAUDE.md` | Document new IT admin files |
