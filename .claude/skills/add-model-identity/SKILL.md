---
name: add-model-identity
description: Add model self-identification so agents correctly respond to "what model are you?" questions. Configurable via CLAUDE_MODEL environment variable.
---

# Add Model Self-Identification

Enable NanoClaw agents to accurately identify their model when asked. Without this, agents respond based on training data rather than the actual model running.

## Background

The Claude Agent SDK does not provide built-in model self-identification. The official approach is to pass model identity via the `systemPrompt` option. This skill:

1. Adds a `CLAUDE_MODEL` config export (defaults to `claude-sonnet-4-5`)
2. Passes the model to the container
3. Parses the model ID into a human-readable name (e.g., `claude-sonnet-4-5` becomes `Claude Sonnet 4.5`)
4. Injects model identity into the agent's system prompt

## Implementation

### Step 1: Add Model Configuration

Add to `src/config.ts` after the existing exports:

```typescript
// --- Claude model configuration ---
// Model aliases auto-resolve to latest version in that tier
// Options: claude-sonnet-4-5, claude-opus-4-6, claude-haiku-4-5
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
```

### Step 2: Import and Pass Model to Container

In `src/index.ts`:

1. Add `CLAUDE_MODEL` to the import from `./config.js`:

```typescript
import {
  ASSISTANT_NAME,
  CLAUDE_MODEL,  // Add this
  DATA_DIR,
  // ... rest of imports
} from './config.js';
```

2. Find the `runContainerAgent()` call in the `runAgent()` function and add `model: CLAUDE_MODEL` to the input object:

```typescript
const output = await runContainerAgent(
  group,
  {
    prompt,
    sessionId,
    groupFolder: group.folder,
    chatJid,
    isMain,
    model: CLAUDE_MODEL,  // Add this line
  },
  // ... rest of arguments
);
```

### Step 3: Update Container Input Interfaces

Add `model` to the `ContainerInput` interface in **both** files:

**In `src/container-runner.ts`:**

```typescript
export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  secrets?: Record<string, string>;
  model?: string;  // Add this line
}
```

**In `container/agent-runner/src/index.ts`:**

```typescript
interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  secrets?: Record<string, string>;
  model?: string;  // Add this line
}
```

### Step 4: Add Model Parsing Function

In `container/agent-runner/src/index.ts`, add this function before the `runQuery()` function:

```typescript
/**
 * Parse model ID to human-readable name.
 * Examples:
 *   claude-sonnet-4-5 -> Claude Sonnet 4.5
 *   claude-opus-4-6 -> Claude Opus 4.6
 *   claude-sonnet-4-5-20250929 -> Claude Sonnet 4.5
 */
function parseModelName(modelId: string): string {
  const match = modelId.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (match) {
    const [, tier, major, minor] = match;
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    return `Claude ${tierName} ${major}.${minor}`;
  }
  return modelId;
}
```

### Step 5: Inject Model Identity into System Prompt

In `container/agent-runner/src/index.ts`, find the `runQuery()` function. After the `globalClaudeMd` loading section (around line 330-335), add:

```typescript
// Build model identity for system prompt
const modelName = containerInput.model ? parseModelName(containerInput.model) : undefined;
const modelIdentity = modelName
  ? `\n\n# Model Identity\nYou are ${modelName} (model ID: ${containerInput.model}). When asked what model you are, always respond with "${modelName}".\n`
  : '';
const systemPromptAppend = (globalClaudeMd || '') + modelIdentity;
```

Then update the `systemPrompt` option in the `query()` call to use `systemPromptAppend`:

```typescript
systemPrompt: systemPromptAppend
  ? { type: 'preset' as const, preset: 'claude_code' as const, append: systemPromptAppend }
  : undefined,
```

Also add the `model` option to the `query()` call:

```typescript
model: containerInput.model,
```

### Step 6: Rebuild and Test

```bash
npm run build
./container/build.sh
```

Send a message asking "What model are you?" and verify the agent responds with the correct model name (e.g., "Claude Sonnet 4.5").

## Configuration

Override the default model via environment variable:

```bash
# In .env
CLAUDE_MODEL=claude-opus-4-6
```

Available model aliases (auto-resolve to latest version):
- `claude-sonnet-4-5` (default, balanced speed and capability)
- `claude-opus-4-6` (most capable, slower)
- `claude-haiku-4-5` (fastest, most economical)

You can also use specific dated versions like `claude-sonnet-4-5-20250929`.
