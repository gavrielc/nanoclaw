// The OneCLI gateway can answer a missing grant with a 401 or a 403, so only
// the `access_restricted` code tells it apart from a stale key. The docs that
// explain auth errors must key on that code, never on the status alone.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const DOCS = ['.claude/skills/debug/SKILL.md'];

describe.each(DOCS)('%s', (file) => {
  const doc = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const paragraphs = doc.split(/\n\s*\n/);

  it('never ties access_restricted to one status', () => {
    expect(doc).toContain('access_restricted');
    expect(doc).not.toMatch(/40[13]\s+access_restricted/);
    expect(doc).toMatch(/401 or 403/);
  });

  it('reads a 401 as a stale or wrong key only without the access_restricted code', () => {
    const staleAdvice = paragraphs.filter((p) => /\b401\b/.test(p) && /\b(stale|wrong|expired)\b/.test(p));
    expect(staleAdvice.length).toBeGreaterThan(0);
    for (const p of staleAdvice) expect(p).toMatch(/401`?\s+without\s+that\s+code/);
  });
});
