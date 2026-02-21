---
name: generative-ui-builder
description: Build and iterate websites on NanoClaw's live canvas. Use when the user asks for landing pages, dashboards, marketing pages, portfolios, or any visual web UI mockup. Prefer set-first then patch refinements through mcp__nanoclaw__update_canvas.
allowed-tools: mcp__nanoclaw__update_canvas, mcp__nanoclaw__send_message
---

# Generative UI Builder

Use this workflow whenever the user wants a website or UI built on the live canvas.

## Core Loop

1. Clarify goal, audience, and visual direction.
2. Build an initial full spec with `mcp__nanoclaw__update_canvas` using `set_spec`.
3. Refine with `patch_ops` instead of replacing everything.
4. Confirm what changed and share canvas URL.

## Tool Contract

Call `mcp__nanoclaw__update_canvas` with one of:

- `set_spec`: full replacement (initial render)
- `patch_ops`: JSON Patch refinement
- `set_spec` + `patch_ops`: apply both in one transaction
- `events`: ordered list of `{type:"set"|"patch", ...}` for advanced updates

Always prefer:

- First call: `set_spec`
- Follow-up calls: `patch_ops`

## Stable Spec Pattern

Use predictable component nodes:

- `Container` / `Stack` for layout wrappers
- `Heading` for section titles
- `Text` for copy
- `Button` for actions
- `Image` for hero/media
- `List` for bullets or steps

Include `style` objects directly on nodes for spacing, typography, colors, and layout.

## Iteration Tactics

- Change only requested sections with targeted JSON Patch ops.
- Keep structure stable; patch content/style values in place.
- If changes become broad, send a fresh `set_spec` and continue patching.

## Response Pattern

After each successful update:

1. Summarize what was rendered.
2. Mention the active group/folder if relevant.
3. Provide the URL:
   `http://127.0.0.1:4318/canvas`
   (or the URL returned by the tool if different).
