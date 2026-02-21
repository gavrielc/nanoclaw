# How to Add Tests

NanoClaw uses [Vitest](https://vitest.dev/) with two separate configs for two test layers.

## Test Layers

### 1. Core Tests (`npm test`)

Config: `vitest.config.ts`
Pattern: `src/**/*.test.ts` and `skills-engine/**/*.test.ts`

These test the host process — routing, database, container runner, formatting, IPC, etc. Place test files next to the source file they test:

```
src/
  routing.ts
  routing.test.ts        ← test lives alongside source
  container-runner.ts
  container-runner.test.ts
```

### 2. Skill Package Tests (`npx vitest run --config vitest.skills.config.ts`)

Config: `vitest.skills.config.ts`
Pattern: `.claude/skills/**/tests/*.test.ts`

These validate that a skill's files are correct and that its integration points are wired into the codebase. Each skill has its own `tests/` directory:

```
.claude/skills/add-google-calendar/
  manifest.yaml
  SKILL.md
  tests/
    google-calendar.test.ts   ← skill tests live here
```

## Writing a Skill Test

Skill tests are **static verification** — they read files from disk and assert their contents are correct. No mocking, no runtime behavior. The pattern:

```typescript
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('my-skill package', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has a valid manifest', () => {
    const content = fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8');
    expect(content).toContain('skill: my-skill');
    expect(content).toContain('version: 1.0.0');
  });
});
```

### What to test in a skill

| Category | What to assert | Example |
|----------|---------------|---------|
| **Manifest** | Skill name, version, declared files, dependencies | `expect(content).toContain('@cocal/google-calendar-mcp')` |
| **Agent runner** | MCP server configured, tools whitelisted | Check `container/agent-runner/src/index.ts` contains the server block and `allowedTools` entry |
| **Container mounts** | Host dirs mounted into container | Check `src/container-runner.ts` contains the mount paths |
| **Agent instructions** | CLAUDE.md files document the tools | Check `groups/global/CLAUDE.md` and `groups/main/CLAUDE.md` list the tool names |
| **Added files** | New source files exist and contain expected classes/functions | Check file exists, contains key identifiers |
| **Modified files** | Existing files still have core structure intact | Check modified files preserve original functions/exports |

### Resolving paths from a skill test

Skill tests live deep in `.claude/skills/<name>/tests/`. Use relative `path.resolve` to reach project files:

```typescript
// Reach project root files from a skill test
const agentRunner = path.resolve(__dirname, '..', '..', '..', '..', 'container', 'agent-runner', 'src', 'index.ts');
const containerRunner = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'container-runner.ts');
const globalClaude = path.resolve(__dirname, '..', '..', '..', '..', 'groups', 'global', 'CLAUDE.md');
```

## Running Tests

```bash
# All core tests
npm test

# Skill package tests
npx vitest run --config vitest.skills.config.ts

# Single skill test
npx vitest run --config vitest.skills.config.ts google-calendar

# Watch mode (re-runs on file change)
npm run test:watch
```
