/**
 * Wiring test for the global sweep-timer override: NANOCLAW_CLAIM_STUCK_MS
 * reaches the constant `decideStuckAction` uses, and a bad value falls back to
 * the default with one warning.
 *
 * `readEnvFile` is wrapped so a developer's own `.env` cannot leak into the
 * "unset" case: it returns {} unless a test points it at a temp project root,
 * where the real parser reads a real `.env` with config.ts's own key list.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({ root: undefined as string | undefined }));
vi.mock('./env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./env.js')>();
  return {
    ...actual,
    readEnvFile: (keys: string[]) => (envState.root ? actual.readEnvFile(keys, envState.root) : {}),
  };
});
const warn = vi.fn();
vi.mock('./log.js', () => ({ log: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } }));

const DEFAULT_CLAIM_MS = 60 * 1000;
const NOW = Date.parse('2026-04-20T12:00:00.000Z');

async function loadWith(env: Record<string, string>) {
  vi.resetModules();
  warn.mockClear();
  vi.stubEnv('NANOCLAW_CLAIM_STUCK_MS', env.NANOCLAW_CLAIM_STUCK_MS ?? '');
  return import('./reconcile-session.js');
}

async function loadWithDotEnv(dotEnv: string, env: Record<string, string> = {}) {
  envState.root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-sweep-env-'));
  fs.writeFileSync(path.join(envState.root, '.env'), dotEnv);
  return loadWith(env);
}

afterEach(() => {
  if (envState.root) fs.rmSync(envState.root, { recursive: true, force: true });
  envState.root = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('sweep timer env overrides', () => {
  it('keeps the built-in default when unset', async () => {
    const { CLAIM_STUCK_MS } = await loadWith({});
    expect(CLAIM_STUCK_MS).toBe(DEFAULT_CLAIM_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores the retired NANOCLAW_ABSOLUTE_CEILING_MS: a 3 h quiet heartbeat never kills', async () => {
    vi.resetModules();
    vi.stubEnv('NANOCLAW_ABSOLUTE_CEILING_MS', '60000');
    const { decideStuckAction } = await import('./reconcile-session.js');
    expect(
      decideStuckAction({ now: NOW, heartbeatMtimeMs: NOW - 3 * 60 * 60 * 1000, containerState: null, claims: [] }),
    ).toEqual({ action: 'ok' });
  });

  it('NANOCLAW_CLAIM_STUCK_MS raises the claim tolerance', async () => {
    const tenMinMs = 10 * 60 * 1000;
    const { CLAIM_STUCK_MS, decideStuckAction } = await loadWith({ NANOCLAW_CLAIM_STUCK_MS: String(tenMinMs) });
    expect(CLAIM_STUCK_MS).toBe(tenMinMs);
    const claimAt = (ageMs: number) => [{ messageId: 'm-1', statusChanged: new Date(NOW - ageMs).toISOString() }];
    const base = { now: NOW, heartbeatMtimeMs: 0, containerState: null };
    // 5 min on a claim: killed at the 60 s default, alive under 10 min.
    expect(decideStuckAction({ ...base, claims: claimAt(5 * 60 * 1000) }).action).toBe('ok');
    expect(decideStuckAction({ ...base, claims: claimAt(tenMinMs + 1) })).toMatchObject({
      action: 'kill-claim',
      messageId: 'm-1',
      toleranceMs: tenMinMs,
    });
  });

  it('falls back to the default with one warning for invalid or out-of-range values', async () => {
    let mod = await loadWith({ NANOCLAW_CLAIM_STUCK_MS: 'soon' });
    expect(mod.CLAIM_STUCK_MS).toBe(DEFAULT_CLAIM_MS);
    expect(warn).toHaveBeenCalledTimes(1);

    mod = await loadWith({ NANOCLAW_CLAIM_STUCK_MS: String(25 * 60 * 60 * 1000) });
    expect(mod.CLAIM_STUCK_MS).toBe(DEFAULT_CLAIM_MS);
    expect(warn).toHaveBeenCalledTimes(1);

    mod = await loadWith({ NANOCLAW_CLAIM_STUCK_MS: '500' });
    expect(mod.CLAIM_STUCK_MS).toBe(DEFAULT_CLAIM_MS);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reads the override from .env through the real parser', async () => {
    const tenMinMs = 10 * 60 * 1000;
    const { CLAIM_STUCK_MS, decideStuckAction } = await loadWithDotEnv(`NANOCLAW_CLAIM_STUCK_MS="${tenMinMs}"\n`);
    expect(CLAIM_STUCK_MS).toBe(tenMinMs);
    expect(warn).not.toHaveBeenCalled();

    const claimAt = (ageMs: number) => [{ messageId: 'm-1', statusChanged: new Date(NOW - ageMs).toISOString() }];
    const claimBase = { now: NOW, heartbeatMtimeMs: 0, containerState: null };
    expect(decideStuckAction({ ...claimBase, claims: claimAt(5 * 60 * 1000) }).action).toBe('ok');
    expect(decideStuckAction({ ...claimBase, claims: claimAt(tenMinMs + 1) })).toMatchObject({
      action: 'kill-claim',
      toleranceMs: tenMinMs,
    });
  });

  it('process env wins over .env', async () => {
    const { CLAIM_STUCK_MS } = await loadWithDotEnv('NANOCLAW_CLAIM_STUCK_MS=600000\n', {
      NANOCLAW_CLAIM_STUCK_MS: '120000',
    });
    expect(CLAIM_STUCK_MS).toBe(120000);
  });
});
