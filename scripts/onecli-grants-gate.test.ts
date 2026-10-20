// Tool skills attach their key with OneCLI agent grants. On a gateway without
// grants (1.42) a saved key reaches every agent and the attach answers 404, so
// the skills check the gateway and CLI before asking for or saving a key.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, '.claude/skills/add-onecli/scripts/check-grants-gateway.sh');
const GATE_CMD = (skill: string) => `sh .claude/skills/add-onecli/scripts/check-grants-gateway.sh ${skill}`;

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'grants-gate-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

function gate(opts: { version?: string; health?: boolean; modes?: string[]; grants?: boolean }) {
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'curl'),
    `#!/bin/sh\n${opts.health === false ? 'exit 7' : `echo '{"status":"ok","version":"${opts.version ?? '1.45.0'}"}'`}\n`,
    { mode: 0o755 },
  );
  const agents = JSON.stringify({
    data: (opts.modes ?? ['selective']).map((m, i) => ({ id: `oc-${i}`, identifier: `ag-${i}`, secretMode: m })),
  });
  fs.writeFileSync(
    path.join(bin, 'onecli'),
    `#!/bin/sh
echo "onecli $*" >> "${home}/calls.log"
case "$1 $2" in
  "config get") echo '{"key":"api-host","value":"http://172.17.0.1:10254"}' ;;
  "agents list") echo '${agents}' ;;
  "agents grants") [ "${opts.grants === false ? 'no' : 'yes'}" = yes ] || { echo "unknown command" >&2; exit 2; } ;;
  *) exit 9 ;;
esac
`,
    { mode: 0o755 },
  );
  const r = spawnSync('sh', [GATE, '/add-vercel'], {
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: home },
    encoding: 'utf8',
  });
  const calls = fs.existsSync(path.join(home, 'calls.log'))
    ? fs.readFileSync(path.join(home, 'calls.log'), 'utf8').trim().split('\n')
    : [];
  return { ...r, calls };
}

describe('OneCLI grants gate', () => {
  it('passes the pinned 1.45 gateway with every agent converted and a CLI that has grants', () => {
    const r = gate({});
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('1.45.0');
  });

  it.each([
    ['a 1.42 gateway', { version: '1.42.0' }, 'older than the pinned 1.45'],
    ['an agent still in all mode', { modes: ['selective', 'all'] }, 'still in all mode'],
    ['a CLI without agents grants', { grants: false }, "no 'agents grants' command"],
    ['an unreachable gateway', { health: false }, 'could not reach the OneCLI gateway'],
    ['a newer gateway', { version: '1.46.0' }, 'newer than the pinned 1.45'],
  ])('refuses %s and writes nothing', (_name, opts, message) => {
    const r = gate(opts);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(message);
    expect(r.stderr).toContain('Nothing was written to OneCLI');
    expect(r.stderr).toContain('/add-vercel');
    expect(r.calls.some((c) => /secrets (create|update)|grants attach/.test(c))).toBe(false);
  });
});

describe('tool skills check the gateway before asking for a key', () => {
  it('/add-vercel runs the gate before asking for the token and before saving it', () => {
    const doc = fs.readFileSync(path.join(ROOT, '.claude/skills/add-vercel/SKILL.md'), 'utf8');
    const at = doc.indexOf(GATE_CMD('/add-vercel'));
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(doc.indexOf('vercel.com/account/tokens'));
    expect(at).toBeLessThan(doc.indexOf('onecli secrets create'));
  });

  it('/add-tavily-tool runs the gate before installing the paid-key upgrade path', () => {
    const doc = fs.readFileSync(path.join(ROOT, '.claude/skills/add-tavily-tool/SKILL.md'), 'utf8');
    const at = doc.indexOf(GATE_CMD('/add-tavily-tool'));
    expect(at).toBeGreaterThan(doc.indexOf('## Phase 5: Install the upgrade path'));
    expect(at).toBeLessThan(doc.indexOf('Resolve the OneCLI dashboard URL'));
  });
});
