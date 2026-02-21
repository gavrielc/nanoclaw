---
name: add-generative-ui
description: Add a live Generative UI canvas to NanoClaw using json-render. Use when users want the agent to build or iterate websites visually on a local canvas, with support for full set and incremental patch updates.
---

# Add Generative UI

This skill installs a live canvas at `http://127.0.0.1:4318/canvas`, exposes canvas APIs under `/api/canvas/`, and adds `mcp__nanoclaw__update_canvas` so runtime agents can build websites incrementally.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `generative-ui` is already in `applied_skills`, skip to Phase 3 (Verify + usage).

### Ask the user

1. Do they want to keep default canvas port `4318` or set `GENUI_PORT`?
2. Should canvas updates target only main, or allow cross-group updates from main (default behavior)?

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)

If `.nanoclaw/` does not exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-generative-ui
```

This deterministically:
- Adds `src/canvas-store.ts` and `src/canvas-server.ts` (+ tests)
- Adds `scripts/build-canvas-ui.mjs`
- Adds canvas web source in `web/src/*` and tracked `web/dist/*`
- Adds runtime skill `container/skills/generative-ui-builder/SKILL.md`
- Merges canvas integration into:
  - `src/config.ts`
  - `src/index.ts`
  - `src/ipc.ts`
  - `src/container-runner.ts`
  - `src/ipc-auth.test.ts`
  - `container/agent-runner/src/ipc-mcp-stdio.ts`
- Installs npm dependencies for json-render/react/runtime patching
- Adds `GENUI_PORT` to `.env.example`
- Runs post-apply build: `node scripts/build-canvas-ui.mjs`

If merge conflicts occur, use intent files under `modify/**/*.intent.md`.

### Validate changes

```bash
npx vitest run --config vitest.skills.config.ts .claude/skills/add-generative-ui/tests/add-generative-ui.test.ts
npx vitest run src/canvas-store.test.ts src/ipc-auth.test.ts
NANOCLAW_SOCKET_TESTS=1 npx vitest run src/canvas-server.test.ts
```

## Phase 3: Configure + Verify

### Set optional port

If the user wants a non-default port, set:

```bash
GENUI_PORT=<port>
```

in `.env`, then sync env if needed.

### Build and restart

```bash
node scripts/build-canvas-ui.mjs
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### Verify endpoints

Open:
- `http://127.0.0.1:4318/canvas`

Check APIs:
- `GET /api/canvas/groups`
- `GET /api/canvas/<group-folder>/state`
- `POST /api/canvas/<group-folder>/events`

### Verify MCP tool

Confirm runtime agents can call:
- `mcp__nanoclaw__update_canvas`

Expected behavior:
- Use `set_spec` for initial render
- Use `patch_ops` for incremental updates
- Main can target any registered `group_folder`
- Non-main can only target its own folder

## Troubleshooting

### Canvas page returns "UI not built"

Run:

```bash
node scripts/build-canvas-ui.mjs
```

### update_canvas times out

Check:
- `/workspace/ipc/responses` exists in the container mount
- host logs for IPC task processing errors
- NanoClaw service is running and `src/ipc.ts` includes `update_canvas` case

### Cross-group update rejected

This is expected for non-main groups. Use main group context for cross-group canvas updates.
