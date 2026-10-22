import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The agent fetches arbitrary URLs with this Node, so its base must carry the
// same security minimum setup enforces on the host (setup/lib/node-version.sh).
// A bare or floating tag lets a rebuild reuse whatever older base is cached.
const here = dirname(fileURLToPath(import.meta.url));
const dockerfile = readFileSync(join(here, 'Dockerfile'), 'utf8');
const lib = join(here, '..', 'setup', 'lib', 'node-version.sh');

describe('container/Dockerfile base image', () => {
  const from = dockerfile.match(/^FROM node:(\S+)$/m);

  it('pins an exact Node release by digest', () => {
    expect(from?.[1]).toMatch(/^\d+\.\d+\.\d+-slim@sha256:[0-9a-f]{64}$/);
  });

  it('is a Node release at or above the security minimum for its line', () => {
    const version = from?.[1].split('-')[0] ?? '';
    const r = spawnSync('bash', ['-c', 'source "$1"; node_version_status "$2"', '_', lib, version], {
      encoding: 'utf8',
    });
    expect(r.stdout.trim()).toBe('ok');
  });
});
