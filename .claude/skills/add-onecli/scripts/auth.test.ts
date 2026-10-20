import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as prompts from '@clack/prompts';

import { run } from './auth.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((_cmd: string, args: string[]) => (args[1] === 'list' ? '{"data":[]}' : '')),
  spawnSync: vi.fn(),
}));
vi.mock('@clack/prompts', () => ({
  isCancel: () => false,
  select: vi.fn(),
  password: vi.fn(),
  log: { success: vi.fn(), warn: vi.fn() },
}));

let root: string;
const argv = process.argv;
beforeEach(() => {
  // No .env here, so no legacy credential is migrated instead of prompting.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'onecli-auth-'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  process.argv = [argv[0], argv[1], 'claude'];
  vi.stubEnv('NANOCLAW_ANTHROPIC_BASE_URL', '');
});
afterEach(() => {
  process.argv = argv;
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it('saves a pasted service-account API key, and the API-key prompt accepts every API key type but not an OAuth token', async () => {
  vi.mocked(prompts.select).mockResolvedValueOnce('api');
  vi.mocked(prompts.password).mockResolvedValueOnce(' sk-ant-svc01-\nfixture ');
  await run();
  expect(execFileSync).toHaveBeenCalledWith(
    'onecli',
    expect.arrayContaining(['create', '--type', 'anthropic', '--value', 'sk-ant-svc01-fixture']),
    expect.anything(),
  );
  const { message, validate } = vi.mocked(prompts.password).mock.calls[0][0];
  expect(message).toMatch(/one workspace/);
  for (const key of ['sk-ant-api03-x', 'sk-ant-usr01-x', 'sk-ant-svc01-x']) expect(validate?.(key)).toBeUndefined();
  expect(validate?.('sk-ant-oat01-x')).toMatch(/OAuth token/);
  expect(validate?.('')).toBe('Required');
});

it('rejects an API key in the OAuth-token prompt', async () => {
  vi.mocked(prompts.select).mockResolvedValueOnce('oauth');
  vi.mocked(prompts.password).mockResolvedValueOnce('sk-ant-oat01-fixture');
  await run();
  const { validate } = vi.mocked(prompts.password).mock.calls[0][0];
  expect(validate?.('sk-ant-oat01-x')).toBeUndefined();
  expect(validate?.('sk-ant-svc01-x')).toMatch(/sk-ant-oat/);
});
