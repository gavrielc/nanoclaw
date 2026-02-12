# IT Admin Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a WhatsApp-triggered code automation system where IT team members send requests to an IT group, the bot interviews them for specs, spawns Claude CLI to implement changes, then commits/pushes/restarts and notifies the team.

**Architecture:** A new `ITAdminService` class with a state machine (idle → gathering_specs → coding → pushing → restarting → notifying → idle) orchestrates an Agent SDK interview agent and a Claude CLI subprocess. Messages from the IT WhatsApp group route through `index.ts` to the service. One task at a time; queue overflow notifies the requester.

**Tech Stack:** TypeScript, Agent SDK (`query()`), Node.js `child_process.spawn`, vitest, WhatsApp (Baileys)

---

### Task 1: Add IT admin fields to TenantConfig and tenant.yaml

**Files:**
- Modify: `src/tenant-config.ts:8-27` (TenantConfig interface)
- Modify: `src/tenant-config.ts:37-48` (DEFAULTS)
- Modify: `src/tenant-config.ts:113-137` (config builder)
- Modify: `src/tenant-config.ts:156-179` (cacheTenantConfigToDb entries)
- Modify: `src/tenant-config.ts:221-240` (getDefaultConfig)
- Modify: `config/tenant.yaml`

**Step 1: Write the failing test**

Add a test in a new section at the bottom of `src/tenant-config.test.ts` (if it exists) or inline below. The test asserts that loading a tenant.yaml with IT fields populates them correctly.

Since tenant-config tests already exist, add to them. If not, create the assertions inline in task 1's test file.

For now, the test is conceptual — the real validation is that `loadTenantConfig()` returns `it_admin_group_name` and `it_admin_phones` from the YAML. We'll verify by running typecheck after the type changes.

**Step 2: Add fields to TenantConfig interface**

In `src/tenant-config.ts`, add to the `TenantConfig` interface after line 26 (`daily_summary_cron`):

```typescript
  // IT Admin automation
  it_admin_group_name: string;
  it_admin_phones: string[];
  wa_it_admin_group_jid: string;
```

**Step 3: Add defaults**

In the `DEFAULTS` object (around line 37), add:

```typescript
  it_admin_group_name: '',
  it_admin_phones: [],
  wa_it_admin_group_jid: '',
```

**Step 4: Add to config builder**

In the config builder (around line 113), add after the `daily_summary_cron` line:

```typescript
    it_admin_group_name: String(merged.it_admin_group_name ?? ''),
    it_admin_phones: Array.isArray(merged.it_admin_phones)
      ? (merged.it_admin_phones as unknown[]).map(String)
      : [],
    wa_it_admin_group_jid: String(merged.wa_it_admin_group_jid ?? ''),
```

**Step 5: Add to cacheTenantConfigToDb**

In the entries array (around line 156), add:

```typescript
    ['it_admin_group_name', config.it_admin_group_name],
    ['it_admin_phones', config.it_admin_phones.join(',')],
    ['wa_it_admin_group_jid', config.wa_it_admin_group_jid],
```

**Step 6: Add to getDefaultConfig**

In `getDefaultConfig()` (around line 221), add:

```typescript
    it_admin_group_name: '',
    it_admin_phones: [],
    wa_it_admin_group_jid: '',
```

**Step 7: Update tenant.yaml**

Add to `config/tenant.yaml` at the end:

```yaml

# IT Admin automation
it_admin_group_name: "Daund IT Team"
it_admin_phones:
  - "918282830830"
```

**Step 8: Run typecheck to verify**

Run: `npm run typecheck`
Expected: PASS (no type errors)

**Step 9: Commit**

```bash
git add src/tenant-config.ts config/tenant.yaml
git commit -m "feat: add IT admin fields to TenantConfig and tenant.yaml"
```

---

### Task 2: Add IT admin config constants

**Files:**
- Modify: `src/config.ts`

**Step 1: Add constants**

Add at the end of `src/config.ts`:

```typescript
// IT Admin handler
export const IT_CODEBOT_NAME = process.env.IT_CODEBOT_NAME || 'CodeBot';
export const IT_CODEBOT_TRIGGER = new RegExp(
  `@${escapeRegex(IT_CODEBOT_NAME)}\\b`,
  'i',
);
export const IT_INTERVIEW_MODEL =
  process.env.IT_INTERVIEW_MODEL || 'claude-sonnet-4-5-20250929';
export const IT_CODING_MODEL =
  process.env.IT_CODING_MODEL || 'claude-opus-4-6';
export const IT_INTERVIEW_MAX_TURNS = safeParseInt(
  process.env.IT_INTERVIEW_MAX_TURNS,
  10,
);
export const IT_CODING_TIMEOUT_MS = safeParseInt(
  process.env.IT_CODING_TIMEOUT_MS,
  1_800_000, // 30 minutes
);
export const IT_INTERVIEW_TIMEOUT_MS = safeParseInt(
  process.env.IT_INTERVIEW_TIMEOUT_MS,
  1_800_000, // 30 minutes
);
export const IT_MAX_QUEUED_REQUESTS = 3;
export const IT_PROGRESS_THROTTLE_MS = 30_000; // 30 seconds between WhatsApp progress updates
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add IT admin config constants"
```

---

### Task 3: Create the interview agent (it-interview-agent.ts)

**Files:**
- Create: `src/it-interview-agent.ts`
- Create: `src/it-interview-agent.test.ts`

**Step 1: Write the failing tests**

Create `src/it-interview-agent.test.ts`:

```typescript
/**
 * it-interview-agent.test.ts — Tests for IT spec interview agent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  InterviewAgent,
  parseSpecFromResponse,
  type ITSpec,
} from './it-interview-agent.js';

const mockedQuery = vi.mocked(query);

function mockQueryResult(responseText: string, sessionId = 'sess-1') {
  const messages = [
    {
      type: 'result' as const,
      subtype: 'success' as const,
      result: responseText,
      session_id: sessionId,
    },
  ];
  mockedQuery.mockReturnValue({
    [Symbol.asyncIterator]: () => {
      let index = 0;
      return {
        next: async () => {
          if (index < messages.length) {
            return { value: messages[index++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseSpecFromResponse', () => {
  it('extracts JSON spec from response with SPEC_COMPLETE marker', () => {
    const response = `Great, I have all the details I need.

SPEC_COMPLETE
{"title":"Add health endpoint","description":"GET /health returning uptime","requirements":["uptime","memory"],"acceptance_criteria":["Returns JSON"],"branch_name":"it/add-health-endpoint"}`;

    const result = parseSpecFromResponse(response);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Add health endpoint');
    expect(result!.branch_name).toBe('it/add-health-endpoint');
    expect(result!.requirements).toHaveLength(2);
  });

  it('returns null when no SPEC_COMPLETE marker', () => {
    const response = 'What HTTP method should /health use? GET or POST?';
    expect(parseSpecFromResponse(response)).toBeNull();
  });

  it('returns null on invalid JSON after marker', () => {
    const response = 'SPEC_COMPLETE\n{invalid json}';
    expect(parseSpecFromResponse(response)).toBeNull();
  });

  it('handles code-fenced JSON after marker', () => {
    const response = `SPEC_COMPLETE
\`\`\`json
{"title":"Test","description":"desc","requirements":[],"acceptance_criteria":[],"branch_name":"it/test"}
\`\`\``;
    const result = parseSpecFromResponse(response);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Test');
  });
});

describe('InterviewAgent', () => {
  it('starts a new session and returns response text', async () => {
    mockQueryResult('What HTTP method should /health use?');
    const agent = new InterviewAgent();

    const result = await agent.sendMessage('Add a /health endpoint');

    expect(result.text).toBe('What HTTP method should /health use?');
    expect(result.spec).toBeNull();
    expect(mockedQuery).toHaveBeenCalledOnce();
  });

  it('resumes session on subsequent messages', async () => {
    mockQueryResult('Question 1?', 'sess-1');
    const agent = new InterviewAgent();
    await agent.sendMessage('initial request');

    mockQueryResult('Question 2?', 'sess-1');
    await agent.sendMessage('answer 1');

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const secondCall = mockedQuery.mock.calls[1][0];
    expect(secondCall.options?.resume).toBe('sess-1');
  });

  it('detects SPEC_COMPLETE and returns parsed spec', async () => {
    const specJson = '{"title":"Test","description":"d","requirements":["r"],"acceptance_criteria":["a"],"branch_name":"it/test"}';
    mockQueryResult(`All clear!\n\nSPEC_COMPLETE\n${specJson}`);
    const agent = new InterviewAgent();

    const result = await agent.sendMessage('everything is clear');

    expect(result.spec).not.toBeNull();
    expect(result.spec!.title).toBe('Test');
  });

  it('reset() clears session', async () => {
    mockQueryResult('Q?', 'sess-1');
    const agent = new InterviewAgent();
    await agent.sendMessage('msg');

    agent.reset();

    mockQueryResult('Fresh Q?', 'sess-2');
    await agent.sendMessage('new msg');

    const call = mockedQuery.mock.calls[1][0];
    expect(call.options?.resume).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/it-interview-agent.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

Create `src/it-interview-agent.ts`:

```typescript
/**
 * it-interview-agent.ts — Conversational spec-gathering agent for IT requests.
 *
 * Uses Agent SDK query() with Sonnet to interview the requester,
 * asking 2-4 clarifying questions. When the spec is complete, the agent
 * outputs a SPEC_COMPLETE marker followed by structured JSON.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';

import { IT_INTERVIEW_MAX_TURNS, IT_INTERVIEW_MODEL } from './config.js';
import { logger } from './logger.js';

export interface ITSpec {
  title: string;
  description: string;
  requirements: string[];
  acceptance_criteria: string[];
  branch_name: string;
}

export interface InterviewResult {
  text: string;
  spec: ITSpec | null;
}

const SYSTEM_PROMPT = `You are a technical product manager gathering requirements for a code change request. Your job is to interview the requester and produce a clear, unambiguous spec.

## Rules
1. Analyze the initial request carefully.
2. Ask 2-4 SHORT clarifying questions, ONE AT A TIME. Wait for answers before asking the next.
3. Keep questions concise — this is a WhatsApp chat, not a document.
4. When you have enough information, output the finalized spec.

## Output Format
When the spec is ready, output exactly this:
- A brief summary of what you understood
- Then on its own line: SPEC_COMPLETE
- Then a JSON object on the next line(s):

SPEC_COMPLETE
{"title":"<short title>","description":"<1-2 sentence description>","requirements":["<req1>","<req2>"],"acceptance_criteria":["<criterion1>","<criterion2>"],"branch_name":"it/<kebab-case-slug>"}

## Important
- The branch_name must start with "it/" and use kebab-case.
- Do NOT output SPEC_COMPLETE until you have asked at least one clarifying question and received an answer.
- If the initial request is extremely clear and complete, you may ask just one confirmation question.
- Keep all text under 500 characters per message (WhatsApp limit friendly).`;

/**
 * Parse a SPEC_COMPLETE block from an agent response.
 * Returns the ITSpec if found, null otherwise.
 */
export function parseSpecFromResponse(text: string): ITSpec | null {
  const markerIndex = text.indexOf('SPEC_COMPLETE');
  if (markerIndex === -1) return null;

  const afterMarker = text.slice(markerIndex + 'SPEC_COMPLETE'.length).trim();
  // Strip code fences
  const cleaned = afterMarker.replace(/```(?:json)?\s*\n?/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (
      typeof parsed.title !== 'string' ||
      typeof parsed.description !== 'string' ||
      !Array.isArray(parsed.requirements) ||
      !Array.isArray(parsed.acceptance_criteria) ||
      typeof parsed.branch_name !== 'string'
    ) {
      return null;
    }
    return parsed as ITSpec;
  } catch {
    return null;
  }
}

/**
 * Stateful interview agent. Call sendMessage() for each user message.
 * Maintains session across calls via Agent SDK resume.
 */
export class InterviewAgent {
  private sessionId: string | undefined;

  async sendMessage(userMessage: string): Promise<InterviewResult> {
    let resultText = '';
    let newSessionId: string | undefined;

    const q = query({
      prompt: userMessage,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        model: IT_INTERVIEW_MODEL,
        maxTurns: IT_INTERVIEW_MAX_TURNS,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        disallowedTools: [
          'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
          'NotebookEdit', 'Task',
        ],
        resume: this.sessionId,
      },
    });

    for await (const message of q) {
      if ('session_id' in message) {
        newSessionId = (message as { session_id: string }).session_id;
      }
      if (
        message.type === 'result' &&
        message.subtype === 'success' &&
        'result' in message
      ) {
        resultText = (message as { result: string }).result;
      }
    }

    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const spec = parseSpecFromResponse(resultText);

    logger.info(
      {
        hasSpec: spec !== null,
        resultLength: resultText.length,
        sessionId: this.sessionId?.slice(0, 8),
      },
      'Interview agent response',
    );

    return { text: resultText, spec };
  }

  /** Reset the agent (clear session). */
  reset(): void {
    this.sessionId = undefined;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/it-interview-agent.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/it-interview-agent.ts src/it-interview-agent.test.ts
git commit -m "feat: add IT interview agent for spec gathering"
```

---

### Task 4: Create the Claude CLI code runner (it-code-runner.ts)

**Files:**
- Create: `src/it-code-runner.ts`
- Create: `src/it-code-runner.test.ts`

**Step 1: Write the failing tests**

Create `src/it-code-runner.test.ts`:

```typescript
/**
 * it-code-runner.test.ts — Tests for Claude CLI subprocess runner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import {
  runClaudeCli,
  buildCodingPrompt,
  parseStreamJsonLine,
  type CodeRunnerResult,
} from './it-code-runner.js';
import type { ITSpec } from './it-interview-agent.js';

const mockedSpawn = vi.mocked(spawn);

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  (proc as any).stdout = new EventEmitter();
  (proc as any).stderr = new EventEmitter();
  (proc as any).stdin = { write: vi.fn(), end: vi.fn() };
  (proc as any).pid = 12345;
  (proc as any).kill = vi.fn();
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildCodingPrompt', () => {
  const spec: ITSpec = {
    title: 'Add health endpoint',
    description: 'GET /health returning server metrics',
    requirements: ['uptime', 'memory usage'],
    acceptance_criteria: ['Returns JSON', '200 on healthy'],
    branch_name: 'it/add-health-endpoint',
  };

  it('includes spec title and description', () => {
    const prompt = buildCodingPrompt(spec);
    expect(prompt).toContain('Add health endpoint');
    expect(prompt).toContain('GET /health returning server metrics');
  });

  it('includes branch name in git instructions', () => {
    const prompt = buildCodingPrompt(spec);
    expect(prompt).toContain('it/add-health-endpoint');
  });

  it('includes requirements and acceptance criteria', () => {
    const prompt = buildCodingPrompt(spec);
    expect(prompt).toContain('uptime');
    expect(prompt).toContain('Returns JSON');
  });

  it('includes git checkout, test, commit, and push instructions', () => {
    const prompt = buildCodingPrompt(spec);
    expect(prompt).toContain('git checkout -b');
    expect(prompt).toContain('npm test');
    expect(prompt).toContain('npm run typecheck');
    expect(prompt).toContain('git push');
  });
});

describe('parseStreamJsonLine', () => {
  it('parses a result message', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Done!',
      session_id: 'sess-1',
    });
    const parsed = parseStreamJsonLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('result');
  });

  it('parses an assistant message', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Working on it...' }] },
    });
    const parsed = parseStreamJsonLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('assistant');
  });

  it('returns null for invalid JSON', () => {
    expect(parseStreamJsonLine('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseStreamJsonLine('')).toBeNull();
  });
});

describe('runClaudeCli', () => {
  it('spawns claude with correct arguments', async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValue(proc);

    const spec: ITSpec = {
      title: 'Test',
      description: 'desc',
      requirements: [],
      acceptance_criteria: [],
      branch_name: 'it/test',
    };

    const promise = runClaudeCli(spec, vi.fn());

    // Emit a result line on stdout then close
    const resultLine = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Implementation complete.',
      session_id: 'sess-1',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    (proc as any).stdout.emit('data', Buffer.from(resultLine + '\n'));
    proc.emit('close', 0);

    const result = await promise;

    expect(mockedSpawn).toHaveBeenCalledOnce();
    const args = mockedSpawn.mock.calls[0][1]!;
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--model');
    expect(result.exitCode).toBe(0);
    expect(result.resultText).toBe('Implementation complete.');
  });

  it('calls onProgress with assistant messages', async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValue(proc);

    const onProgress = vi.fn();
    const spec: ITSpec = {
      title: 'Test',
      description: 'desc',
      requirements: [],
      acceptance_criteria: [],
      branch_name: 'it/test',
    };

    const promise = runClaudeCli(spec, onProgress);

    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Exploring codebase...' }] },
    });
    (proc as any).stdout.emit('data', Buffer.from(assistantLine + '\n'));

    const resultLine = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Done',
      session_id: 'sess-1',
    });
    (proc as any).stdout.emit('data', Buffer.from(resultLine + '\n'));
    proc.emit('close', 0);

    await promise;
    expect(onProgress).toHaveBeenCalled();
  });

  it('returns error on non-zero exit code', async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValue(proc);

    const spec: ITSpec = {
      title: 'Test',
      description: 'desc',
      requirements: [],
      acceptance_criteria: [],
      branch_name: 'it/test',
    };

    const promise = runClaudeCli(spec, vi.fn());
    proc.emit('close', 1);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/it-code-runner.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

Create `src/it-code-runner.ts`:

```typescript
/**
 * it-code-runner.ts — Claude CLI subprocess runner for IT code automation.
 *
 * Spawns `claude` CLI with --output-format stream-json, parses streaming
 * output for progress updates, and collects the final result with token usage.
 */
import { spawn, type ChildProcess } from 'child_process';

import {
  IT_CODING_MODEL,
  IT_CODING_TIMEOUT_MS,
} from './config.js';
import { logger } from './logger.js';
import type { ITSpec } from './it-interview-agent.js';

export interface CodeRunnerResult {
  exitCode: number;
  resultText: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
}

export interface StreamMessage {
  type: string;
  subtype?: string;
  result?: string;
  message?: { content: Array<{ type: string; text?: string }> };
  session_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Build the coding prompt from a finalized spec.
 */
export function buildCodingPrompt(spec: ITSpec): string {
  const reqs = spec.requirements.map((r) => `- ${r}`).join('\n');
  const criteria = spec.acceptance_criteria.map((c) => `- ${c}`).join('\n');

  return `You are implementing a code change for the constituency bot project.

## Task: ${spec.title}

${spec.description}

## Requirements
${reqs}

## Acceptance Criteria
${criteria}

## Instructions
1. Run \`git checkout -b ${spec.branch_name}\` to create a new branch
2. Read CLAUDE.md to understand the project structure and conventions
3. Explore the codebase to understand existing patterns (use Glob, Grep, Read)
4. Implement the changes following existing code style
5. Write tests using vitest (colocated: foo.test.ts next to foo.ts)
6. Run \`npm test\` and fix any failures
7. Run \`npm run typecheck\` and fix any type errors
8. Run \`npm run format\` to format code
9. Commit all changes with a descriptive message
10. Run \`git push -u origin ${spec.branch_name}\`

## Project Context
- TypeScript, Node.js, vitest for testing
- Tests colocated: \`src/foo.test.ts\` next to \`src/foo.ts\`
- Build: \`npm run build\`, Test: \`npm test\`, Typecheck: \`npm run typecheck\`
- Format: \`npm run format\` (prettier)

## IMPORTANT
- Do NOT modify files unrelated to this task
- Do NOT push to main — only push to the \`${spec.branch_name}\` branch
- Commit frequently with descriptive messages
- If tests fail, fix them before pushing`;
}

/**
 * Parse a single line of stream-json output from Claude CLI.
 */
export function parseStreamJsonLine(line: string): StreamMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamMessage;
  } catch {
    return null;
  }
}

/**
 * Extract displayable text from a stream message (for progress updates).
 */
function extractProgressText(msg: StreamMessage): string | null {
  if (msg.type === 'assistant' && msg.message?.content) {
    const textParts = msg.message.content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!);
    if (textParts.length > 0) {
      // Take last 200 chars as a progress snippet
      const full = textParts.join(' ');
      return full.length > 200 ? '...' + full.slice(-200) : full;
    }
  }
  return null;
}

/**
 * Spawn the Claude CLI subprocess and stream results.
 *
 * @param spec — Finalized IT spec
 * @param onProgress — Called with progress text snippets (throttle externally)
 * @returns CodeRunnerResult with exit code, result text, and token usage
 */
export function runClaudeCli(
  spec: ITSpec,
  onProgress: (text: string) => void,
): Promise<CodeRunnerResult> {
  const prompt = buildCodingPrompt(spec);

  return new Promise((resolve) => {
    const proc: ChildProcess = spawn(
      'claude',
      [
        '--output-format', 'stream-json',
        '--model', IT_CODING_MODEL,
        '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep,Task',
        '--permission-mode', 'acceptEdits',
        '-p', prompt,
      ],
      {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      },
    );

    let resultText = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let sessionId: string | undefined;
    let stderrOutput = '';
    let buffer = '';

    // Timeout
    const timeout = setTimeout(() => {
      logger.warn({ pid: proc.pid }, 'Claude CLI timeout, killing process');
      proc.kill('SIGTERM');
    }, IT_CODING_TIMEOUT_MS);

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      // Keep the last incomplete line in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const msg = parseStreamJsonLine(line);
        if (!msg) continue;

        if (msg.session_id) sessionId = msg.session_id;

        if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
          resultText = msg.result;
          if (msg.usage) {
            inputTokens = msg.usage.input_tokens;
            outputTokens = msg.usage.output_tokens;
          }
        }

        const progress = extractProgressText(msg);
        if (progress) onProgress(progress);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);

      // Process any remaining buffer
      if (buffer.trim()) {
        const msg = parseStreamJsonLine(buffer);
        if (msg?.type === 'result' && msg.subtype === 'success' && msg.result) {
          resultText = msg.result;
          if (msg.usage) {
            inputTokens = msg.usage.input_tokens;
            outputTokens = msg.usage.output_tokens;
          }
        }
      }

      const exitCode = code ?? 1;

      if (exitCode !== 0) {
        logger.error(
          { exitCode, stderrLength: stderrOutput.length },
          'Claude CLI exited with error',
        );
      }

      resolve({
        exitCode,
        resultText,
        error: exitCode !== 0 ? stderrOutput.slice(0, 2000) || `Exit code ${exitCode}` : undefined,
        inputTokens,
        outputTokens,
        sessionId,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ err }, 'Claude CLI spawn error');
      resolve({
        exitCode: 1,
        resultText: '',
        error: `Spawn error: ${err.message}`,
      });
    });
  });
}

/**
 * Get the active Claude CLI process handle (for kill on cancel).
 * This is managed by the ITAdminService, not this module.
 */
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/it-code-runner.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/it-code-runner.ts src/it-code-runner.test.ts
git commit -m "feat: add Claude CLI code runner for IT automation"
```

---

### Task 5: Create the IT admin handler (it-admin-handler.ts)

**Files:**
- Create: `src/it-admin-handler.ts`
- Create: `src/it-admin-handler.test.ts`

**Step 1: Write the failing tests**

Create `src/it-admin-handler.test.ts`:

```typescript
/**
 * it-admin-handler.test.ts — Tests for IT admin service state machine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('./it-interview-agent.js', () => ({
  InterviewAgent: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn(),
    reset: vi.fn(),
  })),
  parseSpecFromResponse: vi.fn(),
}));

vi.mock('./it-code-runner.js', () => ({
  runClaudeCli: vi.fn(),
  buildCodingPrompt: vi.fn(() => 'mock prompt'),
}));

import { ITAdminService, type ITAdminDeps } from './it-admin-handler.js';
import { InterviewAgent } from './it-interview-agent.js';
import { runClaudeCli } from './it-code-runner.js';

const mockedRunClaudeCli = vi.mocked(runClaudeCli);

function createMockDeps(): ITAdminDeps {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    itGroupJid: '120363xxx@g.us',
    itAdminPhones: ['918282830830'],
    projectDir: '/tmp/test-project',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ITAdminService', () => {
  describe('isItAdmin', () => {
    it('returns true for phone in allowlist', () => {
      const service = new ITAdminService(createMockDeps());
      expect(service.isItAdmin('918282830830')).toBe(true);
    });

    it('returns false for unknown phone', () => {
      const service = new ITAdminService(createMockDeps());
      expect(service.isItAdmin('919999999999')).toBe(false);
    });
  });

  describe('handleMessage — idle state', () => {
    it('starts interview on @CodeBot trigger', async () => {
      const deps = createMockDeps();
      const service = new ITAdminService(deps);

      const mockAgent = {
        sendMessage: vi.fn().mockResolvedValue({
          text: 'What HTTP method?',
          spec: null,
        }),
        reset: vi.fn(),
      };
      vi.mocked(InterviewAgent).mockImplementation(() => mockAgent as any);

      await service.handleMessage('918282830830', '@CodeBot add health endpoint');

      expect(deps.sendMessage).toHaveBeenCalledWith(
        deps.itGroupJid,
        expect.stringContaining('What HTTP method?'),
      );
      expect(service.getState()).toBe('gathering_specs');
    });

    it('ignores non-trigger messages', async () => {
      const deps = createMockDeps();
      const service = new ITAdminService(deps);

      await service.handleMessage('918282830830', 'hello everyone');

      expect(deps.sendMessage).not.toHaveBeenCalled();
      expect(service.getState()).toBe('idle');
    });
  });

  describe('handleMessage — gathering_specs state', () => {
    it('forwards reply to interview agent', async () => {
      const deps = createMockDeps();
      const service = new ITAdminService(deps);

      const mockAgent = {
        sendMessage: vi.fn()
          .mockResolvedValueOnce({ text: 'Question?', spec: null })
          .mockResolvedValueOnce({ text: 'Got it, another Q?', spec: null }),
        reset: vi.fn(),
      };
      vi.mocked(InterviewAgent).mockImplementation(() => mockAgent as any);

      await service.handleMessage('918282830830', '@CodeBot add feature');
      await service.handleMessage('918282830830', 'GET method');

      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockAgent.sendMessage).toHaveBeenLastCalledWith('GET method');
    });
  });

  describe('handleMessage — busy (queuing)', () => {
    it('queues request when already busy and notifies requester', async () => {
      const deps = createMockDeps();
      const service = new ITAdminService(deps);

      // Start first task (stuck in coding)
      const mockAgent = {
        sendMessage: vi.fn().mockResolvedValue({
          text: 'Done',
          spec: { title: 'T', description: 'd', requirements: [], acceptance_criteria: [], branch_name: 'it/t' },
        }),
        reset: vi.fn(),
      };
      vi.mocked(InterviewAgent).mockImplementation(() => mockAgent as any);

      // Mock runClaudeCli to never resolve (simulates long-running task)
      mockedRunClaudeCli.mockReturnValue(new Promise(() => {}));

      await service.handleMessage('918282830830', '@CodeBot first task');

      // Now a second request comes in
      await service.handleMessage('918282830830', '@CodeBot second task');

      // Should have sent a "queued" notification
      expect(deps.sendMessage).toHaveBeenCalledWith(
        deps.itGroupJid,
        expect.stringContaining('queued'),
      );
    });
  });

  describe('getState', () => {
    it('returns idle initially', () => {
      const service = new ITAdminService(createMockDeps());
      expect(service.getState()).toBe('idle');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/it-admin-handler.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

Create `src/it-admin-handler.ts`:

```typescript
/**
 * it-admin-handler.ts — IT admin service with state machine for code automation.
 *
 * Manages the lifecycle of IT code requests: interview -> code -> push -> restart -> notify.
 * Only processes messages from the IT admin WhatsApp group.
 */
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

import {
  IT_CODEBOT_TRIGGER,
  IT_MAX_QUEUED_REQUESTS,
  IT_PROGRESS_THROTTLE_MS,
  IT_INTERVIEW_TIMEOUT_MS,
  DATA_DIR,
} from './config.js';
import { InterviewAgent, type ITSpec } from './it-interview-agent.js';
import { runClaudeCli, type CodeRunnerResult } from './it-code-runner.js';
import { logger } from './logger.js';

export type ITState =
  | 'idle'
  | 'gathering_specs'
  | 'coding'
  | 'pushing'
  | 'restarting'
  | 'notifying';

export interface ITAdminDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  itGroupJid: string;
  itAdminPhones: string[];
  projectDir: string;
}

interface QueuedRequest {
  phone: string;
  text: string;
}

/** Pending notification file written before restart. */
interface PendingNotification {
  groupJid: string;
  notification: string;
  timestamp: string;
}

const PENDING_NOTIFICATION_PATH = path.join(DATA_DIR, 'pending-it-notification.json');

export class ITAdminService {
  private state: ITState = 'idle';
  private interviewAgent: InterviewAgent | null = null;
  private activeRequesterPhone: string | null = null;
  private interviewTimeout: ReturnType<typeof setTimeout> | null = null;
  private queue: QueuedRequest[] = [];
  private lastProgressTime = 0;

  constructor(private deps: ITAdminDeps) {}

  /** Check if a phone number belongs to an IT admin. */
  isItAdmin(phone: string): boolean {
    return this.deps.itAdminPhones.includes(phone);
  }

  /** Get current state (for testing/monitoring). */
  getState(): ITState {
    return this.state;
  }

  /**
   * Handle an inbound message from the IT admin group.
   * Routes based on current state.
   */
  async handleMessage(senderPhone: string, text: string): Promise<void> {
    const trimmed = text.trim();
    const isTrigger = IT_CODEBOT_TRIGGER.test(trimmed);

    switch (this.state) {
      case 'idle':
        if (isTrigger) {
          await this.startInterview(senderPhone, trimmed);
        }
        break;

      case 'gathering_specs':
        if (isTrigger) {
          // New trigger while interviewing — queue it
          this.queueRequest(senderPhone, trimmed);
        } else if (senderPhone === this.activeRequesterPhone) {
          await this.continueInterview(trimmed);
        }
        break;

      case 'coding':
      case 'pushing':
      case 'restarting':
        if (isTrigger) {
          this.queueRequest(senderPhone, trimmed);
        }
        break;

      default:
        break;
    }
  }

  /**
   * Check for and send pending notification from a previous restart.
   * Called on startup from index.ts.
   */
  async sendPendingNotification(): Promise<void> {
    try {
      if (!fs.existsSync(PENDING_NOTIFICATION_PATH)) return;

      const raw = fs.readFileSync(PENDING_NOTIFICATION_PATH, 'utf-8');
      const pending: PendingNotification = JSON.parse(raw);

      await this.deps.sendMessage(pending.groupJid, pending.notification);
      fs.unlinkSync(PENDING_NOTIFICATION_PATH);

      logger.info('Sent pending IT notification from previous restart');
    } catch (err) {
      logger.error({ err }, 'Failed to send pending IT notification');
      // Clean up corrupt file
      try {
        fs.unlinkSync(PENDING_NOTIFICATION_PATH);
      } catch { /* ignore */ }
    }
  }

  // --- Private methods ---

  private async startInterview(phone: string, text: string): Promise<void> {
    this.state = 'gathering_specs';
    this.activeRequesterPhone = phone;
    this.interviewAgent = new InterviewAgent();

    // Strip @CodeBot prefix
    const stripped = text.replace(IT_CODEBOT_TRIGGER, '').trim();

    await this.deps.sendMessage(
      this.deps.itGroupJid,
      'New IT request received. Analyzing requirements...',
    );

    this.resetInterviewTimeout();

    try {
      const result = await this.interviewAgent.sendMessage(stripped);

      if (result.spec) {
        await this.transitionToCoding(result.spec);
      } else {
        await this.deps.sendMessage(this.deps.itGroupJid, result.text);
      }
    } catch (err) {
      logger.error({ err }, 'Interview agent error');
      await this.deps.sendMessage(
        this.deps.itGroupJid,
        'Error processing request. Please try again.',
      );
      this.resetToIdle();
    }
  }

  private async continueInterview(text: string): Promise<void> {
    if (!this.interviewAgent) {
      this.resetToIdle();
      return;
    }

    this.resetInterviewTimeout();

    try {
      const result = await this.interviewAgent.sendMessage(text);

      if (result.spec) {
        await this.transitionToCoding(result.spec);
      } else {
        await this.deps.sendMessage(this.deps.itGroupJid, result.text);
      }
    } catch (err) {
      logger.error({ err }, 'Interview continuation error');
      await this.deps.sendMessage(
        this.deps.itGroupJid,
        'Error processing reply. Please try again.',
      );
      this.resetToIdle();
    }
  }

  private async transitionToCoding(spec: ITSpec): Promise<void> {
    this.state = 'coding';
    this.clearInterviewTimeout();

    await this.deps.sendMessage(
      this.deps.itGroupJid,
      `Spec finalized. Starting implementation on branch \`${spec.branch_name}\`...\n\nTitle: ${spec.title}\nDescription: ${spec.description}`,
    );

    try {
      const result = await runClaudeCli(spec, (progress) => {
        this.sendThrottledProgress(progress);
      });

      if (result.exitCode === 0) {
        await this.transitionToNotifying(spec, result);
      } else {
        await this.deps.sendMessage(
          this.deps.itGroupJid,
          `Coding failed (exit code ${result.exitCode}).\n\nError: ${result.error?.slice(0, 500) ?? 'Unknown error'}`,
        );
        this.resetToIdle();
      }
    } catch (err) {
      logger.error({ err }, 'Code runner error');
      await this.deps.sendMessage(
        this.deps.itGroupJid,
        'Code runner encountered an unexpected error.',
      );
      this.resetToIdle();
    }
  }

  private async transitionToNotifying(
    spec: ITSpec,
    result: CodeRunnerResult,
  ): Promise<void> {
    this.state = 'notifying';

    // Get git diff stat for the notification
    let filesChanged = 'N/A';
    try {
      filesChanged = execSync(`git diff --stat main...${spec.branch_name}`, {
        cwd: this.deps.projectDir,
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
    } catch {
      // Branch may not exist on main yet; try diff against HEAD~
      try {
        filesChanged = execSync(`git diff --stat HEAD~1`, {
          cwd: this.deps.projectDir,
          encoding: 'utf-8',
          timeout: 10000,
        }).trim();
      } catch { /* best effort */ }
    }

    const notification = [
      'IT Task Complete',
      '',
      `Title: ${spec.title}`,
      `Branch: ${spec.branch_name}`,
      '',
      `Files changed:\n${filesChanged}`,
      '',
      'LLM Usage:',
      `  Input tokens: ${result.inputTokens?.toLocaleString() ?? 'N/A'}`,
      `  Output tokens: ${result.outputTokens?.toLocaleString() ?? 'N/A'}`,
      '',
      'Server restart: Scheduled',
    ].join('\n');

    // Write pending notification for post-restart delivery
    const pending: PendingNotification = {
      groupJid: this.deps.itGroupJid,
      notification: notification + '\n\nServer restarted successfully.',
      timestamp: new Date().toISOString(),
    };

    try {
      fs.mkdirSync(path.dirname(PENDING_NOTIFICATION_PATH), { recursive: true });
      fs.writeFileSync(PENDING_NOTIFICATION_PATH, JSON.stringify(pending, null, 2));
    } catch (err) {
      logger.error({ err }, 'Failed to write pending notification');
    }

    // Send pre-restart notification
    await this.deps.sendMessage(this.deps.itGroupJid, notification);

    this.resetToIdle();

    // Trigger restart via launchctl
    this.triggerRestart();
  }

  private triggerRestart(): void {
    const plistPath = path.join(
      process.env.HOME || '/Users/user',
      'Library/LaunchAgents/com.nanoclaw.plist',
    );

    logger.info('Triggering server restart via launchctl');

    try {
      // Unload + load in background — the current process will be killed by unload
      execSync(
        `launchctl unload "${plistPath}" && sleep 2 && launchctl load "${plistPath}" &`,
        { stdio: 'ignore', timeout: 5000 },
      );
    } catch (err) {
      logger.error({ err }, 'launchctl restart failed');
    }
  }

  private queueRequest(phone: string, text: string): void {
    if (this.queue.length >= IT_MAX_QUEUED_REQUESTS) {
      this.deps.sendMessage(
        this.deps.itGroupJid,
        'Queue is full (max 3). Please wait for the current task to complete.',
      ).catch((err) => logger.error({ err }, 'Failed to send queue-full message'));
      return;
    }

    this.queue.push({ phone, text });
    this.deps.sendMessage(
      this.deps.itGroupJid,
      `Request queued (position ${this.queue.length}). Current task in progress.`,
    ).catch((err) => logger.error({ err }, 'Failed to send queued message'));
  }

  private sendThrottledProgress(text: string): void {
    const now = Date.now();
    if (now - this.lastProgressTime < IT_PROGRESS_THROTTLE_MS) return;
    this.lastProgressTime = now;

    // Truncate for WhatsApp
    const truncated = text.length > 300 ? text.slice(0, 300) + '...' : text;
    this.deps.sendMessage(this.deps.itGroupJid, `[Progress] ${truncated}`)
      .catch((err) => logger.error({ err }, 'Failed to send progress update'));
  }

  private resetInterviewTimeout(): void {
    this.clearInterviewTimeout();
    this.interviewTimeout = setTimeout(() => {
      logger.info('Interview timeout, resetting to idle');
      this.deps.sendMessage(
        this.deps.itGroupJid,
        'Interview timed out (30 min). Request cancelled.',
      ).catch((err) => logger.error({ err }, 'Failed to send timeout message'));
      this.resetToIdle();
    }, IT_INTERVIEW_TIMEOUT_MS);
  }

  private clearInterviewTimeout(): void {
    if (this.interviewTimeout) {
      clearTimeout(this.interviewTimeout);
      this.interviewTimeout = null;
    }
  }

  private resetToIdle(): void {
    this.state = 'idle';
    this.interviewAgent?.reset();
    this.interviewAgent = null;
    this.activeRequesterPhone = null;
    this.clearInterviewTimeout();
    this.lastProgressTime = 0;

    // Process next queued request if any
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      logger.info({ phone: next.phone }, 'Processing next queued IT request');
      // Fire-and-forget — starts the next task
      this.handleMessage(next.phone, next.text).catch((err) =>
        logger.error({ err }, 'Failed to process queued IT request'),
      );
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/it-admin-handler.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/it-admin-handler.ts src/it-admin-handler.test.ts
git commit -m "feat: add IT admin handler with state machine"
```

---

### Task 6: Wire IT admin routing into index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Write the failing test (conceptual)**

This task modifies routing in `index.ts` which is tested via the existing integration/message-routing tests. The key assertions are:
- IT group messages with `@CodeBot` prefix route to ITAdminService
- IT group messages without trigger are ignored
- IT group auto-discovery works

We'll verify via typecheck + existing test suite.

**Step 2: Add imports to index.ts**

Add near the top of `src/index.ts` (after the existing imports around line 65-86):

```typescript
import { ITAdminService } from './it-admin-handler.js';
import { IT_CODEBOT_TRIGGER } from './config.js';
```

**Step 3: Add IT admin service initialization in main()**

In `main()`, after the admin service initialization (around line 1260-1261), add:

```typescript
  // Phase IT: Initialize IT admin service
  let itAdminService: ITAdminService | undefined;
  if (tenantConfig.it_admin_group_name && tenantConfig.it_admin_phones.length > 0) {
    itAdminService = new ITAdminService({
      sendMessage: async (jid, text) => whatsapp.sendMessage(jid, text),
      itGroupJid: tenantConfig.wa_it_admin_group_jid,
      itAdminPhones: tenantConfig.it_admin_phones,
      projectDir: process.cwd(),
    });
  }
```

**Step 4: Add IT group registration function**

After `registerAdminGroup()` (around line 174-184), add:

```typescript
function registerItAdminGroup(jid: string): void {
  if (registeredGroups[jid]) return;
  registerGroup(jid, {
    name: 'IT Admin',
    folder: 'it-admin',
    trigger: '',
    added_at: new Date().toISOString(),
    requiresTrigger: true,
  });
  logger.info({ jid }, 'Registered IT admin group');
}
```

**Step 5: Register IT group on startup**

After the admin group registration in `main()` (around line 1292-1294), add:

```typescript
  // Register IT admin group
  if (tenantConfig.wa_it_admin_group_jid) {
    registerItAdminGroup(tenantConfig.wa_it_admin_group_jid);
  }
```

**Step 6: Add IT group auto-discovery**

After the admin group auto-discovery block (around line 1375-1393), add:

```typescript
  // Auto-discover IT admin group by name
  if (tenantConfig.it_admin_group_name && !tenantConfig.wa_it_admin_group_jid) {
    if (!tenantConfig.wa_admin_group_jid) {
      // Admin group discovery already triggered syncGroupMetadata
    } else {
      await whatsapp.syncGroupMetadata(true);
    }
    const itJid = findGroupJidByName(tenantConfig.it_admin_group_name);
    if (itJid) {
      tenantConfig.wa_it_admin_group_jid = itJid;
      if (itAdminService) {
        (itAdminService as any).deps.itGroupJid = itJid;
      }
      cacheTenantConfigToDb(getDb(), tenantConfig);
      registerItAdminGroup(itJid);
      logger.info(
        { jid: itJid, name: tenantConfig.it_admin_group_name },
        'Auto-discovered IT admin group',
      );
    } else {
      logger.warn(
        { name: tenantConfig.it_admin_group_name },
        'IT admin group not found — create a WhatsApp group with this name and restart',
      );
    }
  }
```

**Step 7: Add IT group routing in handleInboundMessage()**

In `handleInboundMessage()` (around line 987), add a new branch **before** the admin group check (before line 996):

```typescript
  // IT admin group: route @CodeBot messages to IT handler
  if (
    tenantConfig.wa_it_admin_group_jid &&
    chatJid === tenantConfig.wa_it_admin_group_jid &&
    itAdminService
  ) {
    advanceCursor(chatJid, msg.timestamp);
    const phone = phoneFromJid(msg.sender);
    if (!itAdminService.isItAdmin(phone)) return;

    (async () => {
      try {
        await itAdminService.handleMessage(phone, msg.content);
      } catch (err) {
        logger.error({ err }, 'IT admin handler error');
        try {
          await whatsapp.sendMessage(chatJid, 'Internal error processing IT request.');
        } catch { /* best-effort */ }
      }
    })();
    return;
  }
```

Note: `itAdminService` needs to be accessible in `handleInboundMessage()`. Since it's defined in `main()`, either:
- Move it to module scope (like `whatsapp` and `queue`), or
- Pass it via closure in the `onMessage` callback

The simplest approach: declare `let itAdminService: ITAdminService | undefined;` at module scope (around line 136-137, near the other module-scope vars), and assign it in `main()`.

**Step 8: Send pending IT notification on startup**

In `main()`, after WhatsApp connects (after `await whatsapp.connect()` around line 1372), add:

```typescript
  // Send any pending IT notification from previous restart
  if (itAdminService) {
    await itAdminService.sendPendingNotification();
  }
```

**Step 9: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 10: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire IT admin routing into message handler"
```

---

### Task 7: Update CLAUDE.md with IT admin documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add to Key Files table**

In `CLAUDE.md`, add these rows to the Key Files table:

```markdown
| `src/it-admin-handler.ts` | IT admin service: state machine, @CodeBot routing, queue |
| `src/it-interview-agent.ts` | Conversational spec-gathering agent (Agent SDK) |
| `src/it-code-runner.ts` | Claude CLI subprocess for code automation |
```

**Step 2: Add to Architecture section**

Add a new subsection under Architecture:

```markdown
### IT Admin Automation Flow
- **IT group**: `@CodeBot <request>` → interview agent (spec gathering) → Claude CLI subprocess (coding) → git push → launchctl restart → notification
- State machine: idle → gathering_specs → coding → pushing → restarting → notifying → idle
- One task at a time, max 3 queued. IT phones exempt from rate limits.
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add IT admin handler to CLAUDE.md"
```

---

### Task 8: Run full test suite and verify build

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `npm test`
Expected: ALL PASS (660+ tests)

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Run format**

Run: `npm run format`
Expected: No errors

**Step 4: Verify build**

Run: `npm run build`
Expected: PASS

**Step 5: Final commit (if format changed anything)**

```bash
git add -A
git commit -m "chore: format after IT admin implementation"
```
