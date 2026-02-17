import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listAvailableSkills, shouldIncludeSkill, syncSkills } from './skill-sync.js';

describe('shouldIncludeSkill', () => {
  it('includes everything when no filter', () => {
    expect(shouldIncludeSkill('agent-browser')).toBe(true);
    expect(shouldIncludeSkill('anything')).toBe(true);
  });

  it('allow mode: only includes listed skills', () => {
    const filter = { mode: 'allow' as const, skills: ['agent-browser'] };
    expect(shouldIncludeSkill('agent-browser', filter)).toBe(true);
    expect(shouldIncludeSkill('agent-other', filter)).toBe(false);
  });

  it('deny mode: excludes listed skills', () => {
    const filter = { mode: 'deny' as const, skills: ['agent-browser'] };
    expect(shouldIncludeSkill('agent-browser', filter)).toBe(false);
    expect(shouldIncludeSkill('agent-other', filter)).toBe(true);
  });

  it('empty skills list: allow=nothing, deny=everything', () => {
    expect(shouldIncludeSkill('x', { mode: 'allow', skills: [] })).toBe(false);
    expect(shouldIncludeSkill('x', { mode: 'deny', skills: [] })).toBe(true);
  });
});

describe('listAvailableSkills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty for non-existent dir', () => {
    expect(listAvailableSkills('/nonexistent-path')).toEqual([]);
  });

  it('returns only directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'skill-a'));
    fs.mkdirSync(path.join(tmpDir, 'skill-b'));
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'hi');

    const result = listAvailableSkills(tmpDir);
    expect(result.sort()).toEqual(['skill-a', 'skill-b']);
  });
});

describe('syncSkills', () => {
  let srcDir: string;
  let dstDir: string;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
    srcDir = path.join(base, 'src');
    dstDir = path.join(base, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });

    // Create source skills
    for (const name of ['agent-browser', 'agent-code', 'agent-research']) {
      const dir = path.join(srcDir, name);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'skill.md'), `# ${name}`);
    }
  });

  afterEach(() => {
    // Clean up parent of srcDir
    fs.rmSync(path.dirname(srcDir), { recursive: true, force: true });
  });

  it('copies all skills when no filter', () => {
    syncSkills(srcDir, dstDir);
    const synced = fs.readdirSync(dstDir).sort();
    expect(synced).toEqual(['agent-browser', 'agent-code', 'agent-research']);
  });

  it('copies only allowed skills', () => {
    syncSkills(srcDir, dstDir, { mode: 'allow', skills: ['agent-browser'] });
    const synced = fs.readdirSync(dstDir);
    expect(synced).toEqual(['agent-browser']);
  });

  it('excludes denied skills', () => {
    syncSkills(srcDir, dstDir, { mode: 'deny', skills: ['agent-browser'] });
    const synced = fs.readdirSync(dstDir).sort();
    expect(synced).toEqual(['agent-code', 'agent-research']);
  });

  it('removes previously synced skills that are now filtered out', () => {
    // First sync: all skills
    syncSkills(srcDir, dstDir);
    expect(fs.readdirSync(dstDir).sort()).toEqual(['agent-browser', 'agent-code', 'agent-research']);

    // Second sync: only agent-browser allowed
    syncSkills(srcDir, dstDir, { mode: 'allow', skills: ['agent-browser'] });
    expect(fs.readdirSync(dstDir)).toEqual(['agent-browser']);
  });

  it('does nothing when source does not exist', () => {
    syncSkills('/nonexistent', dstDir);
    expect(fs.existsSync(dstDir)).toBe(false);
  });

  it('copies file contents correctly', () => {
    syncSkills(srcDir, dstDir, { mode: 'allow', skills: ['agent-code'] });
    const content = fs.readFileSync(path.join(dstDir, 'agent-code', 'skill.md'), 'utf-8');
    expect(content).toBe('# agent-code');
  });
});
