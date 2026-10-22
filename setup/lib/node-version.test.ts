/**
 * setup/lib/node-version.sh decides which Node setup accepts: a supported line
 * at or above its release with the October 21, 2026 security fixes. These run
 * the real scripts under bash, on a PATH that holds only stub node / brew /
 * apt-get and a few coreutils, so no host Node or package manager leaks in.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const libDir = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(libDir, 'node-version.sh');
const INSTALL_NODE = path.resolve(libDir, '..', 'install-node.sh');
const SETUP_SH = path.resolve(libDir, '..', '..', 'setup.sh');
const NANOCLAW_SH = path.resolve(libDir, '..', '..', 'nanoclaw.sh');

function which(cmd: string): string {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  const found = r.stdout.trim();
  if (r.status !== 0 || !found) throw new Error(`${cmd} not found on the test host`);
  return found;
}

const BASH = which('bash');
const TOOLS = ['bash', 'cat', 'cut', 'dirname', 'grep', 'head', 'ln', 'mkdir', 'sed', 'tee'].map(
  (tool) => [tool, which(tool)] as const,
);

let tmp: string;
let bin: string;
let home: string;
let state: string;
let keg: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-node-version-'));
  bin = path.join(tmp, 'bin');
  home = path.join(tmp, 'home');
  state = path.join(tmp, 'state');
  keg = path.join(tmp, 'keg');
  for (const dir of [bin, home, state]) fs.mkdirSync(dir);
  for (const [tool, real] of TOOLS) fs.symlinkSync(real, path.join(bin, tool));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function stub(dir: string, name: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `#!${BASH}\n${body}\n`, { mode: 0o755 });
}

/** A `node` in `dir` that reports the version held in `<dir>/.node-version`. */
function fakeNode(dir: string, version?: string): void {
  stub(dir, 'node', '[ "$1" = --version ] && read -r v < "${0%/*}/.node-version" && echo "$v"');
  if (version) fs.writeFileSync(path.join(dir, '.node-version'), `v${version}\n`);
}

/**
 * Installer stubs that log to calls.log. apt-get installs or upgrades the PATH
 * node in place to `aptGives`; `brew install node@22` puts `brewGives` in the keg.
 */
function installers(opts: { uname: 'Linux' | 'Darwin'; aptGives?: string; brewGives?: string }): void {
  const log = path.join(state, 'calls.log');
  stub(bin, 'uname', `echo ${opts.uname}`);
  stub(bin, 'curl', `echo "curl $*" >> ${log}`);
  stub(bin, 'sudo', `echo "sudo $*" >> ${log}; [ "$1" = -E ] && shift; exec "$@"`);
  fakeNode(state);
  stub(
    bin,
    'apt-get',
    `echo "apt-get $*" >> ${log}` +
      (opts.aptGives
        ? `\n[ -e ${bin}/node ] || ln -s ${state}/node ${bin}/node\necho v${opts.aptGives} > ${bin}/.node-version`
        : ''),
  );
  fakeNode(path.join(keg, 'bin'));
  stub(
    bin,
    'brew',
    [
      `echo "brew $*" >> ${log}`,
      `case "$1" in`,
      `  --prefix) echo ${keg} ;;`,
      `  install) ${opts.brewGives ? `echo v${opts.brewGives} > ${keg}/bin/.node-version` : ':'} ;;`,
      `esac`,
    ].join('\n'),
  );
}

function calls(): string[] {
  const log = path.join(state, 'calls.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
}

function bash(args: string[]): { status: number | null; out: string } {
  const r = spawnSync(BASH, args, { encoding: 'utf8', env: { PATH: bin, HOME: home } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function field(out: string, name: string): string | undefined {
  return out.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1];
}

const status = (version: string) => bash(['-c', 'source "$1"; node_version_status "$2"', '_', LIB, version]).out.trim();

describe('node_version_status', () => {
  it.each([
    ['22.23.4', 'ok'],
    ['v22.23.4', 'ok'],
    ['22.24.0', 'ok'],
    ['24.22.1', 'ok'],
    ['24.23.0', 'ok'],
    ['26.12.1', 'ok'],
    ['27.0.0', 'ok'],
    ['22.23.3', 'outdated'],
    ['22.9.99', 'outdated'],
    ['24.22.0', 'outdated'],
    ['26.2.5', 'outdated'],
    ['23.11.1', 'unsupported'],
    ['25.3.0', 'unsupported'],
    ['v27.0.0-nightly20261018f88a1d25e9', 'unsupported'],
    ['22.24.0-rc.1', 'unsupported'],
    ['20.19.5', 'old'],
    ['18.20.8', 'old'],
    ['', 'old'],
    ['garbage', 'old'],
    ['22.23', 'old'],
  ])('%s -> %s', (version, expected) => {
    expect(status(version)).toBe(expected);
  });
});

describe('node_use_patched', () => {
  const pathNode = () =>
    bash(['-c', 'source "$1"; node_use_patched; echo "rc=$?"; command -v node', '_', LIB]).out.trim().split('\n');

  it('moves the patched Node from ~/.local/bin ahead of an unpatched PATH Node', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '22.20.0');
    fakeNode(path.join(home, '.local', 'bin'), '24.22.1');
    expect(pathNode()).toEqual(['rc=0', path.join(home, '.local', 'bin', 'node')]);
  });

  it("uses Homebrew's keg-only node@22 on macOS", () => {
    installers({ uname: 'Darwin' });
    fs.writeFileSync(path.join(keg, 'bin', '.node-version'), 'v22.23.4\n');
    fakeNode(bin, '24.10.0');
    expect(pathNode()).toEqual(['rc=0', path.join(keg, 'bin', 'node')]);
  });

  it('keeps a patched PATH Node in front', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '24.22.1');
    fakeNode(path.join(home, '.local', 'bin'), '22.23.4');
    expect(pathNode()).toEqual(['rc=0', path.join(bin, 'node')]);
  });

  it('fails and leaves PATH alone when nothing patched is installed', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '22.20.0');
    fakeNode(path.join(home, '.local', 'bin'), '22.21.0');
    expect(pathNode()).toEqual(['rc=1', path.join(bin, 'node')]);
  });
});

describe('setup/install-node.sh', () => {
  const installNode = () => bash([INSTALL_NODE]);

  it('leaves a patched Node alone', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '22.23.4');
    const r = installNode();
    expect(r.status).toBe(0);
    expect(field(r.out, 'STATUS')).toBe('already-installed');
    expect(calls()).toEqual([]);
  });

  it('installs Node 22 through nodesource when there is no Node', () => {
    installers({ uname: 'Linux', aptGives: '22.23.4' });
    const r = installNode();
    expect(r.status).toBe(0);
    expect(field(r.out, 'STATUS')).toBe('installed');
    expect(field(r.out, 'NODE_VERSION')).toBe('v22.23.4');
    expect(calls()).toContain('curl -fsSL https://deb.nodesource.com/setup_22.x');
  });

  it('upgrades an unpatched Node 22 through nodesource', () => {
    installers({ uname: 'Linux', aptGives: '22.23.4' });
    fakeNode(bin, '22.20.0');
    const r = installNode();
    expect(r.status).toBe(0);
    expect(field(r.out, 'STATUS')).toBe('installed');
    expect(field(r.out, 'NODE_VERSION')).toBe('v22.23.4');
    expect(calls()).toEqual([
      'curl -fsSL https://deb.nodesource.com/setup_22.x',
      'sudo -E /bin/bash -',
      'sudo apt-get install -y nodejs',
      'apt-get install -y nodejs',
    ]);
  });

  it('keeps an unpatched Node 24 on its own nodesource line', () => {
    installers({ uname: 'Linux', aptGives: '24.22.1' });
    fakeNode(bin, '24.10.0');
    const r = installNode();
    expect(field(r.out, 'STATUS')).toBe('installed');
    expect(calls()).toContain('curl -fsSL https://deb.nodesource.com/setup_24.x');
  });

  it('still installs Node 22 over Node 20', () => {
    installers({ uname: 'Linux', aptGives: '22.23.4' });
    fakeNode(bin, '20.19.5');
    const r = installNode();
    expect(field(r.out, 'STATUS')).toBe('installed');
    expect(calls()).toContain('curl -fsSL https://deb.nodesource.com/setup_22.x');
  });

  it('stops in plain words when the PATH Node is still unpatched after the install', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '22.20.0');
    const r = installNode();
    expect(r.status).toBe(1);
    expect(field(r.out, 'STATUS')).toBe('failed');
    expect(field(r.out, 'ERROR')).toBe(
      `Node v22.20.0 (${bin}/node) is missing the October 2026 security fixes. ` +
        'Update it to 22.23.4 or newer, then run setup again.',
    );
  });

  it('points Node 20 at 24 or 22 when the install cannot replace it', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '20.19.5');
    const r = installNode();
    expect(r.status).toBe(1);
    expect(field(r.out, 'ERROR')).toBe(
      `Node v20.19.5 (${bin}/node) does not get security fixes. ` +
        'Install Node 24 (24.22.1 or newer) or Node 22 (22.23.4 or newer), then run setup again.',
    );
  });

  it('refuses an end-of-life Node 25 without installing anything', () => {
    installers({ uname: 'Linux', aptGives: '22.23.4' });
    fakeNode(bin, '25.3.0');
    const r = installNode();
    expect(r.status).toBe(1);
    expect(field(r.out, 'ERROR')).toContain('Node v25.3.0');
    expect(field(r.out, 'ERROR')).toContain('Install Node 24 (24.22.1 or newer) or Node 22 (22.23.4 or newer)');
    expect(calls()).toEqual([]);
  });

  it("installs Homebrew's node@22 on macOS and reports the patched keg Node", () => {
    installers({ uname: 'Darwin', brewGives: '22.23.4' });
    fakeNode(bin, '24.10.0');
    const r = installNode();
    expect(r.status).toBe(0);
    expect(field(r.out, 'NODE_VERSION')).toBe('v22.23.4');
    expect(calls()).toContain('brew install node@22');
  });
});

/** A function's source from setup.sh, so it runs without the rest of the bootstrap. */
function setupFunction(name: string): string {
  const source = fs.readFileSync(SETUP_SH, 'utf8');
  const start = source.indexOf(`${name}() {`);
  expect(start, `${name}() not found in setup.sh`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

describe('setup.sh check_node', () => {
  function checkNode(version: string): string {
    fakeNode(bin, version);
    const fn = setupFunction('check_node');
    return bash(['-c', `source "$1"; log() { :; }\n${fn}\ncheck_node; echo "$NODE_OK"`, '_', LIB]).out.trim();
  }

  it('counts only a patched Node as ready', () => {
    expect(checkNode('22.20.0')).toBe('false');
    expect(checkNode('25.3.0')).toBe('false');
    expect(checkNode('22.23.4')).toBe('true');
    expect(checkNode('24.22.1')).toBe('true');
  });
});

describe('setup.sh ensure_node', () => {
  function ensureNode(): string {
    const project = path.join(tmp, 'project');
    stub(
      path.join(project, 'setup'),
      'install-node.sh',
      `echo install-node >> ${path.join(state, 'calls.log')}; exit 1`,
    );
    const fns = `${setupFunction('check_node')}\n${setupFunction('ensure_node')}`;
    const prelude = `source "$1"; PROJECT_ROOT=${project}; LOG_FILE=${path.join(state, 'bootstrap.log')}; log() { :; }`;
    return bash(['-c', `${prelude}\n${fns}\nensure_node; echo "NODE_OK=$NODE_OK"`, '_', LIB]).out.trim();
  }

  it('uses an installed patched Node that is off PATH instead of installing again', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '22.20.0');
    fakeNode(path.join(home, '.local', 'bin'), '24.22.1');
    expect(ensureNode()).toBe('NODE_OK=true');
    expect(calls()).toEqual([]);
  });

  it('runs install-node.sh when no patched Node is installed', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '22.20.0');
    expect(ensureNode()).toMatch(/NODE_OK=false$/);
    expect(calls()).toEqual(['install-node']);
  });
});

describe('setup.sh install_deps', () => {
  it("runs pnpm install with the checked Node, not an npm prefix's older one", () => {
    const fn = setupFunction('install_deps');
    const log = path.join(state, 'calls.log');
    const prefix = path.join(tmp, 'npm-prefix');
    fakeNode(bin, '24.22.1');
    fakeNode(path.join(prefix, 'bin'), '22.20.0');
    stub(path.join(prefix, 'bin'), 'pnpm', `echo "pnpm $1 node=$(node --version)" >> ${log}`);
    stub(bin, 'npm', `[ "$*" = "config get prefix" ] && echo ${prefix} || :`);
    const prelude = [
      `PROJECT_ROOT=${tmp}`,
      `LOG_FILE=${path.join(state, 'bootstrap.log')}`,
      'PLATFORM=linux NODE_OK=true',
      'log() { :; }',
    ].join('\n');
    bash(['-c', `${prelude}\n${fn}\ninstall_deps`]);
    expect(calls()).toEqual(['pnpm install node=v24.22.1']);
  });
});

describe('nanoclaw.sh hand-off', () => {
  // The real PATH recovery before `exec pnpm ... setup:auto`, which registers
  // the service with `command -v node`; the exec is swapped for a print of it.
  function handoff(): { status: number | null; out: string } {
    const source = fs.readFileSync(NANOCLAW_SH, 'utf8');
    const start = source.indexOf('# setup.sh may have just installed Node/npm/pnpm');
    const exec = 'exec pnpm --silent run setup:auto "$@"';
    const end = source.indexOf(exec);
    expect(start, 'hand-off section not found in nanoclaw.sh').toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const prelude = [
      'set -euo pipefail',
      `PROJECT_ROOT=${path.resolve(libDir, '..', '..')}`,
      `red() { printf '%s' "$1"; }`,
      'write_abort_entry() { :; }',
    ].join('\n');
    return bash(['-c', `${prelude}\n${source.slice(start, end)}echo "HANDOFF $(command -v node)"`]);
  }

  it("keeps the checked Node ahead of an npm prefix's older one", () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '24.22.1');
    const prefix = path.join(tmp, 'npm-prefix');
    fakeNode(path.join(prefix, 'bin'), '22.20.0');
    stub(path.join(prefix, 'bin'), 'pnpm', ':');
    stub(bin, 'npm', `[ "$*" = "config get prefix" ] && echo ${prefix}`);
    const r = handoff();
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe(`HANDOFF ${bin}/node`);
  });

  it('switches to the patched Node before npm runs, since npm refuses an old one', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '12.22.12');
    const localBin = path.join(home, '.local', 'bin');
    fakeNode(localBin, '24.22.1');
    stub(localBin, 'npm', `[ "$(node --version)" = v24.22.1 ] || exit 1; echo ${path.join(tmp, 'no-prefix')}`);
    const r = handoff();
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe(`HANDOFF ${localBin}/node`);
  });

  it('keeps a patched PATH Node ahead of an older one in ~/.local/bin', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '22.23.4');
    fakeNode(path.join(home, '.local', 'bin'), '22.12.0');
    expect(handoff().out.trim()).toBe(`HANDOFF ${bin}/node`);
  });

  it('hands setup:auto the patched keg node@22 over an unpatched PATH Node', () => {
    installers({ uname: 'Darwin' });
    fs.writeFileSync(path.join(keg, 'bin', '.node-version'), 'v22.23.4\n');
    fakeNode(bin, '24.10.0');
    expect(handoff().out.trim()).toBe(`HANDOFF ${keg}/bin/node`);
  });

  it('stops before setup:auto when no patched Node is reachable', () => {
    installers({ uname: 'Linux' });
    fakeNode(bin, '24.10.0');
    const r = handoff();
    expect(r.status).toBe(1);
    expect(r.out).toContain('is missing the October 2026 security fixes. Update it to 24.22.1 or newer');
    expect(r.out).not.toContain('HANDOFF');
  });
});
