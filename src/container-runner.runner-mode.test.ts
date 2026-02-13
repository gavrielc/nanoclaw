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

async function loadRunner(runnerMode: string) {
  vi.resetModules();

  const fakeProc = createFakeProcess();

  vi.doMock('./config.js', () => ({
    CONTAINER_IMAGE: 'nanoclaw-agent:latest',
    CONTAINER_MAX_OUTPUT_SIZE: 10485760,
    CONTAINER_TIMEOUT: 1800000,
    DATA_DIR: '/tmp/nanoclaw-test-data',
    GROUPS_DIR: '/tmp/nanoclaw-test-groups',
    IDLE_TIMEOUT: 1800000,
    RUNNER_MODE: runnerMode,
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
        existsSync: vi.fn(() => false),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(() => ''),
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
  const { spawn } = await import('node:child_process');

  return { fakeProc, runContainerAgent, spawn };
}

describe('container-runner runner mode mounts', () => {
  it('mounts agent-runner source in dev mode', async () => {
    const { fakeProc, runContainerAgent, spawn } = await loadRunner('dev');
    const resultPromise = runContainerAgent(testGroup, testInput, () => {});

    fakeProc.emit('close', 0);
    await resultPromise;

    const calls = vi.mocked(spawn).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const args = calls[0][1] as string[];
    expect(args.join(' ')).toContain('/app/src');
  });

  it('does not mount agent-runner source in prebuilt mode', async () => {
    const { fakeProc, runContainerAgent, spawn } = await loadRunner('prebuilt');
    const resultPromise = runContainerAgent(testGroup, testInput, () => {});

    fakeProc.emit('close', 0);
    await resultPromise;

    const calls = vi.mocked(spawn).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const args = calls[0][1] as string[];
    expect(args.join(' ')).not.toContain('/app/src');
  });
});
