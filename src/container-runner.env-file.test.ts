import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { RegisteredGroup } from './types.js';

function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

describe('container-runner env file propagation', () => {
  it('includes NANOCLAW_RUNNER_MODE when set in process env', async () => {
    vi.resetModules();

    const fakeProc = createFakeProcess();
    const writeCalls: Array<{ path: string; content: string }> = [];
    const previousRunnerMode = process.env.NANOCLAW_RUNNER_MODE;
    process.env.NANOCLAW_RUNNER_MODE = 'dev';

    vi.doMock('./config.js', () => ({
      CONTAINER_IMAGE: 'nanoclaw-agent:latest',
      CONTAINER_MAX_OUTPUT_SIZE: 10485760,
      CONTAINER_TIMEOUT: 1800000,
      DATA_DIR: '/tmp/nanoclaw-test-data',
      GROUPS_DIR: '/tmp/nanoclaw-test-groups',
      IDLE_TIMEOUT: 1800000,
      RUNNER_MODE: 'prebuilt',
    }));

    vi.doMock('./logger.js', () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn((p: string) => p.endsWith('.env')),
          mkdirSync: vi.fn(),
          writeFileSync: vi.fn((p: string, content: string) => {
            writeCalls.push({ path: p, content });
          }),
          readFileSync: vi.fn(() => 'CLAUDE_CODE_OAUTH_TOKEN=test-token\\n'),
          readdirSync: vi.fn(() => []),
          statSync: vi.fn(() => ({ isDirectory: () => false })),
          copyFileSync: vi.fn(),
        },
      };
    });

    vi.doMock('./mount-security.js', () => ({
      validateAdditionalMounts: vi.fn(() => []),
    }));

    vi.doMock('node:child_process', async () => {
      const actual =
        await vi.importActual<typeof import('node:child_process')>(
          'node:child_process',
        );
      return {
        ...actual,
        spawn: vi.fn(() => fakeProc),
        exec: vi.fn(
          (_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
            if (cb) cb(null);
            return new EventEmitter();
          },
        ),
      };
    });

    const { runContainerAgent } = await import('./container-runner.js');

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    fakeProc.emit('close', 0);
    await resultPromise;

    const envWrite = writeCalls.find((call) => call.path.endsWith('/env'));
    expect(envWrite?.content).toContain('NANOCLAW_RUNNER_MODE=dev');

    if (previousRunnerMode === undefined) {
      delete process.env.NANOCLAW_RUNNER_MODE;
    } else {
      process.env.NANOCLAW_RUNNER_MODE = previousRunnerMode;
    }
  });
});
