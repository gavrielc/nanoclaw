import { spawn } from 'child_process';
import type { AdapterInput, ContainerOutput } from './interface.js';

type CliPreset = 'codex' | 'cursor-agent';

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function getCliPreset(): CliPreset | null {
  const backend = process.env.AGENT_BACKEND;
  if (backend === 'codex' || backend === 'cursor-agent') return backend;
  return null;
}

function parseCodexJsonl(stdout: string): string | null {
  let lastTextItem: string | null = null;
  let lastAgentMessage: string | null = null;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.type === 'item.completed' && typeof obj.item?.text === 'string') {
        lastTextItem = obj.item.text;
        if (obj.item?.type === 'agent_message') {
          lastAgentMessage = obj.item.text;
        }
      }
    } catch { }
  }
  return lastAgentMessage ?? lastTextItem;
}

function parseCursorJson(stdout: string): string | null {
  try {
    const obj = JSON.parse(stdout);
    if (obj.result) return obj.result;
    if (obj.text) return obj.text;
  } catch { }
  return null;
}

function parseCliArgs(rawArgs: string): string[] {
  const parsed = JSON.parse(rawArgs);
  if (!Array.isArray(parsed) || parsed.some((arg) => typeof arg !== 'string')) {
    throw new Error('AGENT_CLI_ARGS must be a JSON array of strings');
  }
  return parsed;
}

export const cliAdapter = {
  async *run(input: AdapterInput): AsyncGenerator<ContainerOutput> {
    const preset = getCliPreset();
    if (!preset) {
      yield { status: 'error', result: null, error: 'AGENT_BACKEND must be "codex" or "cursor-agent" for CLI adapter' };
      return;
    }

    let csv: string;
    let args: string[];
    let useStdin = false;

    if (preset === 'codex') {
      csv = process.env.AGENT_CLI_CMD || 'codex';
      args = [
        'exec',
        '-C', input.cwd,
        '--dangerously-bypass-approvals-and-sandbox',
        '--json',
        '-',
      ];
      useStdin = true;
      const extraArgs = process.env.AGENT_CLI_ARGS;
      if (extraArgs) {
        try {
          const parsed = parseCliArgs(extraArgs);
          args.splice(-1, 0, ...parsed);
        } catch (err) {
          yield {
            status: 'error',
            result: null,
            error: err instanceof Error ? err.message : 'Invalid AGENT_CLI_ARGS',
          };
          return;
        }
      }
    } else if (preset === 'cursor-agent') {
      csv = process.env.AGENT_CLI_CMD || 'cursor-agent';
      const outputFormat = process.env.AGENT_CLI_OUTPUT_FORMAT || 'text';
      args = [
        '-p',
        '--trust',
        '--workspace', input.cwd,
        `--output-format`, outputFormat,
        input.prompt,
      ];
    } else {
      yield { status: 'error', result: null, error: `Unknown preset: ${preset}` };
      return;
    }

    const timeoutMs = parseInt(process.env.CONTAINER_TIMEOUT || '1800000', 10);

    const child = spawn(csv, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...input.env },
      cwd: input.cwd,
    });

    let stdout = '';
    let stderr = '';

    const stdoutPromise = new Promise<void>((resolve, reject) => {
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stdout?.on('end', resolve);
      child.stdout?.on('error', reject);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      log(chunk.toString().trim());
    });

    if (useStdin && child.stdin) {
      child.stdin.write(input.prompt);
      child.stdin.end();
    }

    const exitPromise = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', (err) => {
        log(`CLI spawn error: ${err.message}`);
        resolve(-1);
      });
    });

    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const result = await Promise.race([
      Promise.all([stdoutPromise, exitPromise]).then(([, code]) => ({ code })),
      timeoutPromise.then(() => ({ code: 'timeout' as const })),
    ]);

    if (result.code === 'timeout') {
      child.kill('SIGKILL');
      yield {
        status: 'error',
        result: null,
        error: `CLI timed out after ${timeoutMs}ms`,
      };
      return;
    }

    const code = result.code;
    if (code !== 0 && code !== null) {
      yield {
        status: 'error',
        result: null,
        error: `CLI exited with code ${code}: ${stderr.slice(-500)}`,
      };
      return;
    }

    let text: string | null = null;
    if (preset === 'codex') {
      text = parseCodexJsonl(stdout);
    } else if (preset === 'cursor-agent') {
      const outputFormat = process.env.AGENT_CLI_OUTPUT_FORMAT || 'text';
      if (outputFormat === 'json') {
        text = parseCursorJson(stdout);
      } else {
        text = stdout.trim() || null;
      }
    }

    yield {
      status: 'success',
      result: text,
    };
  },
};
