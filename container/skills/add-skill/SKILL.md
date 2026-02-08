---
name: add-skill
description: Create new skills for this group. Use when the user asks to add a new capability, integration, or automation. Researches existing solutions, plans the implementation, and creates a proper SDK-discoverable skill.
---

# Add Skill

Create a new skill that will be auto-discovered and available in future sessions. Skills are stored at `/workspace/group/.claude/skills/{name}/SKILL.md`.

## State Management

This workflow spans multiple messages. Use file-based state to track progress across sessions.

**State files** (in `/workspace/group/`):
- `.add-skill-state.json` — Current phase and metadata
- `.add-skill-research.json` — Research findings
- `.add-skill-plan.json` — Implementation plan

**On every invocation**, check for existing state:
```bash
cat /workspace/group/.add-skill-state.json 2>/dev/null
```

If state exists, resume from the saved phase. If not, start fresh.

**Clean up on completion:**
```bash
rm -f /workspace/group/.add-skill-state.json
rm -f /workspace/group/.add-skill-research.json
rm -f /workspace/group/.add-skill-plan.json
```

## Workflow

### Phase 1: Research

When the user requests a new skill:

1. **Search the web** for relevant APIs, tools, and services
2. **Check for MCP servers** — search GitHub for `mcp-server-{topic}`
3. **Check for CLI tools** — search npm or GitHub for relevant packages
4. **Identify requirements** — authentication, API keys, dependencies

Present a concise summary to the user:
- What existing tools/APIs were found
- Recommended approach
- Any credentials or setup needed

Save state after research:
```json
{"phase": "planning", "skill_name": "...", "timestamp": "..."}
```

### Phase 2: Planning

Ask the user about:
1. **Scope** — What specific functionality do they need?
2. **Trigger** — Should it activate automatically or only on explicit request?
3. **Credentials** — Do they have API keys or accounts needed?

Present a brief implementation plan and wait for approval.

Save state:
```json
{"phase": "awaiting_approval", "skill_name": "...", "timestamp": "..."}
```

### Phase 3: Implementation

Once approved, create the skill:

1. Create the skill directory and file:
   ```
   /workspace/group/.claude/skills/{name}/SKILL.md
   ```

2. Write the SKILL.md with proper frontmatter and instructions (see format below)

3. If the skill needs helper scripts, create them alongside the SKILL.md:
   ```
   /workspace/group/.claude/skills/{name}/run.js
   /workspace/group/.claude/skills/{name}/package.json
   ```

4. If the skill needs credentials, instruct the user on how to provide them
   (e.g., store in `/workspace/group/.env.local`)

5. Clean up state files

### Phase 4: Verification

- Confirm the skill file exists and is readable
- Tell the user what was created
- Explain that the skill will be auto-discovered in future sessions
- Provide an example prompt they can try

## Skill Format

Every skill needs a `SKILL.md` with this structure:

```markdown
---
name: skill-name
description: Brief description of what this skill does and when to use it.
---

# Skill Title

What this skill does and when it applies.

## Instructions

Step-by-step instructions for performing the task.

## Examples

Example interactions showing how the skill works.

## Requirements

Any dependencies, credentials, or setup needed.
```

The `name` and `description` in the frontmatter are how the SDK decides when to activate the skill. Write a clear, specific description.

## Example Interaction

**User**: "Add a skill for checking stock prices"

**Phase 1** — Research:
- Found: Yahoo Finance has a free API, no auth needed
- Found: Alpha Vantage API has a free tier with API key
- Recommend: Yahoo Finance for simplicity

**Phase 2** — Planning:
- "I'll create a stock prices skill that fetches quotes via Yahoo Finance.
   No API key needed. Should I include historical data or just current prices?"
- User approves current prices only

**Phase 3** — Implementation:
- Creates `/workspace/group/.claude/skills/stock-prices/SKILL.md`
- Skill includes instructions to fetch and format stock data

**Phase 4** — Verification:
- "Created the stock-prices skill. Try asking: 'What's the current price of AAPL?'"

## Notes

- Skills are per-group. Each group can have different skills.
- Skills persist across sessions (stored in the mounted workspace).
- Keep skill documents concise — the SDK loads them into context.
- The SDK auto-discovers skills from the frontmatter. No manual registration needed.
